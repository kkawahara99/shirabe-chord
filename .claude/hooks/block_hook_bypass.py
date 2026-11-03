"""Claude が git の検査フック（.githooks/）を外すコマンドを実行する前に止める（PreToolUse）。

権限の deny ルールは前方一致なので、`git commit -m x --no-verify` や `git commit -qn` のように
後ろや短いオプションの束に入れた形を拾えない。ここではコマンドを分解して調べる。

止めるもの:
- git の各サブコマンドの `--no-verify`（と、git が受け付けるその省略形）
- `git commit` の `-n`（`-qn` などの束も含む）
- `core.hooksPath` の変更（`git config` での設定・削除、`-c`、GIT_CONFIG_* の環境変数）。読み取りは通す。

解析できないコマンドは、それらしい文字列が含まれていれば止める。
"""

from __future__ import annotations

import json
import re
import shlex
import sys
from typing import Iterable, Optional

NO_VERIFY = "--no-verify"
# git は一意に決まる長いオプションの省略を受け付ける（--no-verif など）。--no-v より短いものは曖昧で通らない
MIN_NO_VERIFY_ABBREV = len("--no-v")
HOOKS_PATH = "hookspath"
OPERATORS = {"&&", "||", ";", "|", "&", "(", ")", ";;", "|&"}
GIT_GLOBAL_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
# git commit の短いオプションのうち、引数を取るもの（後ろの文字や次の語は引数になる）
COMMIT_SHORT_WITH_ARG = set("mFcCtSu")
COMMIT_LONG_WITH_ARG = {
    "--message", "--file", "--template", "--reuse-message", "--reedit-message", "--fixup", "--squash",
    "--author", "--date", "--cleanup", "--trailer", "--pathspec-from-file",
}
CONFIG_READ_FLAGS = {
    "--get", "--get-all", "--get-regexp", "--local", "--global", "--system", "--worktree", "--show-origin", "--show-scope",
}
# 引数の文字列をコマンドとして実行するもの。中身ももう一度調べる
SHELLS = {"sh", "bash", "zsh", "dash", "pwsh", "powershell", "pwsh.exe", "powershell.exe", "bash.exe", "sh.exe"}
SHELL_COMMAND_FLAGS = {"-c", "-command", "-lc"}

MESSAGE = (
    "git の検査フック（.githooks/）を外す操作は止めています（docs/adr/0004）。"
    "検査で止まったら、指摘に従って直してください。どうしても外す必要があるなら、本人が自分のターミナルで行います。"
)


def is_no_verify(token: str) -> bool:
    return len(token) >= MIN_NO_VERIFY_ABBREV and NO_VERIFY.startswith(token)


def is_git(token: str) -> bool:
    name = re.split(r"[\\/]", token)[-1].casefold()
    return name in ("git", "git.exe")


def split_segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    segments: list[list[str]] = [[]]
    for token in lexer:
        if token in OPERATORS:
            segments.append([])
        else:
            segments[-1].append(token)
    return [s for s in segments if s]


def _commit_bypass(args: list[str]) -> Optional[str]:
    i = 0
    while i < len(args):
        token = args[i]
        i += 1
        if token == "--":
            return None
        if token.startswith("--"):
            if is_no_verify(token):
                return "git commit --no-verify"
            if "=" not in token and token in COMMIT_LONG_WITH_ARG:
                i += 1
            continue
        if token.startswith("-") and len(token) > 1:
            cluster = token[1:]
            for pos, flag in enumerate(cluster):
                if flag == "n":
                    return "git commit -n"
                if flag in COMMIT_SHORT_WITH_ARG:
                    if pos == len(cluster) - 1 and flag not in "Su":  # -S / -u の引数は付けて書くときだけ
                        i += 1
                    break
    return None


def _config_changes_hooks_path(args: list[str]) -> bool:
    if not any(HOOKS_PATH in a.casefold() for a in args):
        return False
    flags = [a for a in args if a.startswith("-")]
    others = [a for a in args if not a.startswith("-")]
    is_read = all(f in CONFIG_READ_FLAGS for f in flags) and len(others) == 1
    return not is_read


def _git_bypass(segment: list[str], start: int) -> Optional[str]:
    """segment[start] が git のときに、その呼び出しが検査を外すかどうかを調べる。"""
    i = start + 1
    while i < len(segment) and segment[i].startswith("-"):
        option = segment[i]
        if HOOKS_PATH in option.casefold() or (option == "-c" and i + 1 < len(segment) and HOOKS_PATH in segment[i + 1].casefold()):
            return "git -c core.hooksPath"
        i += 2 if option in GIT_GLOBAL_OPTS_WITH_ARG else 1
    if i >= len(segment):
        return None
    subcommand, args = segment[i], segment[i + 1 :]
    if subcommand == "config":
        return "git config core.hooksPath の変更" if _config_changes_hooks_path(args) else None
    if subcommand == "commit":
        return _commit_bypass(args)
    if any(is_no_verify(a) for a in args):
        return f"git {subcommand} --no-verify"
    return None


def _fallback(command: str) -> Optional[str]:
    lowered = command.casefold()
    if "--no-v" in lowered or HOOKS_PATH in lowered:
        return "解析できないコマンドに、検査を外す指定らしい文字列がある"
    if "commit" in lowered and re.search(r"\s-[A-Za-z]*n", command):
        return "解析できないコマンドに、git commit -n らしい指定がある"
    return None


def nested_commands(segment: list[str]) -> list[str]:
    """`sh -c '…'`・`pwsh -Command '…'`・`eval …` の中のコマンド文字列を取り出す。"""
    nested = []
    for i, token in enumerate(segment):
        name = re.split(r"[\\/]", token)[-1].casefold()
        if name == "eval":
            nested.append(" ".join(segment[i + 1 :]))
        elif name in SHELLS:
            for j in range(i + 1, len(segment) - 1):
                if segment[j].casefold() in SHELL_COMMAND_FLAGS:
                    nested.append(segment[j + 1])
                    break
    return nested


def find_bypass(command: str, depth: int = 0) -> Optional[str]:
    """検査を外す操作が含まれていれば、その種類を返す。

    範囲外として通すもの: 変数や `$(…)` で組み立てた git、git の別名（alias）、
    スクリプトファイル経由の実行。これらは allow に入っておらず、権限の確認に任せる。
    """
    try:
        segments = split_segments(command)
    except ValueError:
        return _fallback(command)
    has_git = any(is_git(token) for segment in segments for token in segment)
    for segment in segments:
        # 環境変数で core.hooksPath を渡す形（GIT_CONFIG_KEY_0=core.hooksPath、export、$env: など）
        if has_git and any(HOOKS_PATH in t.casefold() and "=" in t for t in segment):
            return "環境変数での core.hooksPath の指定"
        for position in (i for i, token in enumerate(segment) if is_git(token)):
            found = _git_bypass(segment, position)
            if found:
                return found
        if depth < 3:
            for nested in nested_commands(segment):
                found = find_bypass(nested, depth + 1)
                if found:
                    return found
    return None


def commands_from(payload: dict) -> Iterable[str]:
    command = (payload.get("tool_input") or {}).get("command")
    return [command] if isinstance(command, str) else []


def main() -> int:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    for command in commands_from(payload):
        found = find_bypass(command)
        if found:
            print(f"{MESSAGE}（検出: {found}）", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
