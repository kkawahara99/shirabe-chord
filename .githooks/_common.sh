# pre-commit / commit-msg / pre-push / scan-history から読み込む共通部分。必要な道具が無ければ、検査を飛ばさずに止める。

ROOT=$(git rev-parse --show-toplevel) || exit 1
GUARD="$ROOT/.githooks/commit_guard.py"
export PYTHONUTF8=1

PYTHON=
for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    PYTHON=$candidate
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "commit-guard: Python 3.9 以上が見つかりません" >&2
  exit 1
fi

GITLEAKS=${GITLEAKS:-gitleaks}
if ! command -v "$GITLEAKS" >/dev/null 2>&1; then
  echo "commit-guard: gitleaks が見つかりません。README の「コミット前の検査」を参照して入れてください" >&2
  exit 1
fi

# gitleaks の画面出力（--verbose）は、秘密の値だけを伏せて同じ行の残りを出すため使わない。
# JSON のレポートを受け取り、ルールID・場所・行番号だけを表示する。
# GL_QUIET が空でなければ結果を表示しない（run_gitleaks_messages が使う）。GL_LABEL は結果の見出し。
GL_QUIET=
GL_LABEL=
# gitleaks git は git log -p を使い、-p だけではマージコミットの差分が出ない。マージの解決で入った内容も見るため、
# 最初の親との差分を出す（pre-push と scan-history の --log-opts に付ける）
GL_MERGE_OPT="--diff-merges=first-parent"
run_gitleaks() {
  gl_report=$(mktemp) || return 1
  "$GITLEAKS" "$@" --config "$ROOT/.gitleaks.toml" --redact --no-banner --log-level error \
    --report-format json --report-path "$gl_report"
  gl_status=$?
  if [ "$gl_status" -ne 0 ] && [ -z "$GL_QUIET" ]; then
    "$PYTHON" "$GUARD" gitleaks-report "$gl_report" --label "$GL_LABEL"
  fi
  rm -f "$gl_report"
  return "$gl_status"
}

# 範囲（$@ は git rev-list の引数）のコミットメッセージを gitleaks で検査する。
# gitleaks の起動は約 2 秒かかるので、まず全メッセージを 1 つの入力にして 1 回だけ流す。
# 指摘が出たときだけ、コミットごとに流し直して短縮ハッシュを特定する。
run_gitleaks_messages() {
  gm_file=$(mktemp) || return 1
  if ! "$PYTHON" "$GUARD" messages -- "$@" > "$gm_file"; then
    rm -f "$gm_file"
    return 1
  fi
  GL_QUIET=1
  run_gitleaks stdin < "$gm_file"
  gm_status=$?
  GL_QUIET=
  rm -f "$gm_file"
  [ "$gm_status" -eq 0 ] && return 0

  gm_found=
  for gm_commit in $(git rev-list "$@"); do
    GL_LABEL="コミット $(printf '%.8s' "$gm_commit") のメッセージ"
    # --no-walk: そのコミット 1 つだけ（付けないと祖先のメッセージまで入り、特定できない）
    "$PYTHON" "$GUARD" messages -- --no-walk "$gm_commit" | run_gitleaks stdin && continue
    gm_found=1
  done
  GL_LABEL=
  if [ -z "$gm_found" ]; then
    echo "commit-guard: メッセージの gitleaks 検査が失敗しましたが、どのコミットか特定できません" >&2
  fi
  return 1
}
