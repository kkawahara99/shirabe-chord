#!/usr/bin/env bash
# マージ済みの worktree／ローカルブランチを自動回収する。
# work-issue（PR運用）が作る feature worktree は、PR レビュー後の追撃修正に使うため
# 「マージ済みになるまで残す」のが正。マージは作業セッションより後（人間ゲート）に起きるので、
# 回収は非同期にやるしかない。それをこのスクリプトが SessionStart フックから担う。
#
# 安全策（誤って作業中を消さない）:
#   - 本体（リポジトリ直下）は対象外
#   - 未コミット変更がある worktree は残す
#   - 対応 PR が MERGED のブランチだけ remove + branch -D する（未マージ・PR無しは残す）
#   - remove が失敗しても、git が登録を外した後（Windows で消しきれなかった状態）に限り rm -rf で消しきる。
#     登録が残る失敗（ロック等）は git が断ったものなので触らない
#   - ローカル HEAD が MERGED PR の headRefOid と同じか、その祖先のときだけ削除する（未 push コミットの
#     消失、ブランチ名再利用時の誤削除を防ぐ。PR のマージ前に GitHub 側で積まれた
#     「Merge branch 'main' into ...」をローカルが取り込んでいなくても、祖先なので失うものはない。
#     同名ブランチで複数の MERGED PR が返ることがあるため、いずれか1つに当てはまれば削除継続とする）
#   - 前提と限界: PR の最終コミットがローカルに fetch 済みであること（無ければ残す）。ブランチ名を
#     使い回し、本体の main が古いまま同名で作り直した直後の worktree（まだ独自コミット無し）は、
#     旧 PR の祖先に見えて消えうる。失うコミットは無いが、ignore 済みファイルは消える。
#
# 出力は stderr のみ（SessionStart の stdout はコンテキストに注入されるため汚さない）。
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

# gh が無い／未認証なら静かに何もしない（ローカル環境差で失敗させない）
command -v gh >/dev/null 2>&1 || exit 0

# worktree 一覧（branch を持つものだけ）を「パス<TAB>refs/heads/...」で取り出す
git worktree list --porcelain 2>/dev/null | awk '
  /^worktree /{wt=substr($0, 10)}   # 空白を含むパスも切らない
  /^branch /{print wt"\t"$2}
' | while IFS=$'\t' read -r wt ref; do
  branch="${ref#refs/heads/}"
  [ "$wt" = "$ROOT" ] && continue                       # 本体は触らない
  [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ] && continue  # 作業中は残す

  merged_oids="$(gh pr list --head "$branch" --state merged --json headRefOid --jq '.[].headRefOid' </dev/null 2>/dev/null)"
  [ -n "$merged_oids" ] || continue  # 対応する MERGED PR が無い

  local_head="$(git -C "$wt" rev-parse HEAD 2>/dev/null)"
  [ -n "$local_head" ] || continue

  match=0
  while IFS= read -r oid; do
    [ -n "$oid" ] || continue
    # PR の最終コミットに含まれる（同一も可）なら、ローカルだけにあるコミットは無い。
    # oid がローカルに無い（未 fetch）ときは失敗するので、安全側に倒れてスキップする。
    git merge-base --is-ancestor "$local_head" "$oid" 2>/dev/null && match=1
  done <<< "$merged_oids"

  if [ "$match" -eq 1 ]; then
    # Windows では node_modules などを消しきれず `git worktree remove` が途中で失敗する。
    # git は登録（管理ディレクトリ）だけ先に消して戻るので、フォルダだけが登録を外れて残り、
    # 以後この一覧に出ず二度と回収されない。登録が外れているときに限り、rm -rf で消しきる。
    # 登録が残っているなら git が意図して断った（ロック等）ので、触らない。
    if ! git worktree remove "$wt" 2>/dev/null; then
      if git worktree list --porcelain 2>/dev/null | grep -Fxq "worktree $wt"; then
        echo "cleanup-merged-worktrees: skip '$branch' (git refused to remove it, e.g. locked)" >&2
        continue
      fi
      rm -rf "$wt" 2>/dev/null
      if [ -e "$wt" ]; then
        # 登録は外れているので次回以降は拾えない。手で消してもらう
        echo "cleanup-merged-worktrees: could not delete '$wt'; delete it and branch '$branch' by hand" >&2
        continue
      fi
    fi
    # PR が MERGED 確定（＝リモートに取り込み済み）なので強制削除でよい。
    # squash／rebase マージはブランチのコミットが main 履歴に残らず -d が拒否するため -D を使う。
    if git branch -D "$branch" 2>/dev/null; then
      echo "cleanup-merged-worktrees: removed merged worktree '$branch'" >&2
    else
      echo "cleanup-merged-worktrees: removed worktree but could not delete branch '$branch'" >&2
    fi
  else
    echo "cleanup-merged-worktrees: skip '$branch' (local HEAD $local_head is not contained in the MERGED PR head — unpushed commit, reused branch name, or PR head not fetched yet)" >&2
  fi
done

git worktree prune 2>/dev/null || true
exit 0
