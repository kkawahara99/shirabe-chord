# pre-commit / commit-msg から読み込む共通部分。必要な道具が無ければ、検査を飛ばさずに止める。

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
run_gitleaks() {
  gl_report=$(mktemp) || return 1
  "$GITLEAKS" "$@" --config "$ROOT/.gitleaks.toml" --redact --no-banner --log-level error \
    --report-format json --report-path "$gl_report"
  gl_status=$?
  if [ "$gl_status" -ne 0 ]; then
    "$PYTHON" "$GUARD" gitleaks-report "$gl_report"
  fi
  rm -f "$gl_report"
  return "$gl_status"
}
