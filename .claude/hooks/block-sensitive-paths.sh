#!/bin/sh
# PreToolUse（Bash・PowerShell・Read・Edit・Write・NotebookEdit・Glob・Grep）:
# ダウンロードフォルダ・資格情報の置き場所・ブラウザのプロファイルに触れる操作を止める。
# Python が無い、またはフックが異常終了したときは、検査できないので止める（Claude Code は終了コード 2 以外を止めずに通すため）。
input=$(cat)

for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s' "$input" | "$candidate" "$(dirname "$0")/block_sensitive_paths.py"
    code=$?
    if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
      echo "block-sensitive-paths: 検査が異常終了したため、操作を止めます" >&2
      code=2
    fi
    exit "$code"
  fi
done
echo "block-sensitive-paths: Python 3.9 以上が見つからないため、操作を止めます" >&2
exit 2
