#!/bin/sh
# PreToolUse（Bash・PowerShell）: gh で GitHub に文章を書き込む操作を、実行前に検査する（docs/adr/0010）。
# Python が無い、またはフックが異常終了したときは、検査できないので止める（Claude Code は終了コード 2 以外を止めずに通すため）。
input=$(cat)

# gh の語が無ければ、Python を起動せずに通す（Bash を呼ぶたびに走るので速くする）。大文字小文字は区別しない（PowerShell の `GH`）
if ! printf '%s' "$input" | grep -qi 'gh'; then
  exit 0
fi

for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s' "$input" | "$candidate" "$(dirname "$0")/block_unchecked_gh_writes.py"
    code=$?
    if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
      echo "block-unchecked-gh-writes: 検査が異常終了したため、操作を止めます" >&2
      code=2
    fi
    exit "$code"
  fi
done
echo "block-unchecked-gh-writes: Python 3.9 以上が見つからないため、操作を止めます" >&2
exit 2
