#!/usr/bin/env bash
# マージ済みの worktree／ローカルブランチを自動回収する。
# work-issue（PR運用）が作る feature worktree は、PR レビュー後の追撃修正に使うため
# 「マージ済みになるまで残す」のが正。マージは作業セッションより後（人間ゲート）に起きるので、
# 回収は非同期にやるしかない。それをこのスクリプトが SessionStart フックから担う。
#
# 安全策（誤って作業中を消さない）:
#   - 本体（リポジトリ直下）は対象外
#   - 未コミット変更がある worktree は残す
#   - 対応 PR が MERGED のブランチだけ remove + branch -d する（未マージ・PR無しは残す）
#   - MERGED PR の headRefOid とローカル HEAD が一致する場合だけ削除する（未 push コミットの消失、
#     ブランチ名再利用時の誤削除を防ぐ。同名ブランチで複数の MERGED PR が返ることがあるため、
#     いずれか1つの headRefOid と一致すれば削除継続とする）
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
  /^worktree /{wt=$2}
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
    [ "$oid" = "$local_head" ] && match=1
  done <<< "$merged_oids"

  if [ "$match" -eq 1 ]; then
    if git worktree remove "$wt" 2>/dev/null; then
      # PR が MERGED 確定（＝リモートに取り込み済み）なので強制削除でよい。
      # squash／rebase マージはブランチのコミットが main 履歴に残らず -d が拒否するため -D を使う。
      git branch -D "$branch" 2>/dev/null || true
      echo "cleanup-merged-worktrees: removed merged worktree '$branch'" >&2
    fi
  else
    echo "cleanup-merged-worktrees: skip '$branch' (MERGED PR headRefOid does not match local HEAD $local_head — possible unpushed commit or reused branch name)" >&2
  fi
done

git worktree prune 2>/dev/null || true
exit 0
