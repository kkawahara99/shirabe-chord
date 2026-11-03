#!/bin/sh
# PreToolUse（Bash）: git の検査フックを外すコマンドを止める。Python が無ければ、検査できないので止める。
input=$(cat)

# 関係する語が無ければ、Python を起動せずに通す（Bash を呼ぶたびに走るので速くする）
if ! printf '%s' "$input" | grep -qiE 'no-v|hookspath|commit'; then
  exit 0
fi

for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s' "$input" | "$candidate" "$(dirname "$0")/block_hook_bypass.py"
    code=$?
    # Claude Code は終了コード 2 以外を止めずに通すので、異常終了は 2 にして止める
    if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
      echo "block-hook-bypass: 検査が異常終了したため、コマンドを止めます" >&2
      code=2
    fi
    exit "$code"
  fi
done
echo "block-hook-bypass: Python 3.9 以上が見つからないため、コマンドを止めます" >&2
exit 2
