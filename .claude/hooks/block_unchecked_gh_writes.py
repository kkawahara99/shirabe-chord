"""Claude が gh で GitHub に文章を書き込む前に、公開してよい内容かを検査する（PreToolUse）。

Issue・PR・コメント・ラベル・リポジトリの説明は、書き直しても前の版が履歴に残る（docs/adr/0004）。
権限の確認（ask）は `--body-file` の中身を見せないので、実行する前にここで検査する（docs/adr/0010）。
検査そのものは、コミットメッセージの検査（`.githooks/commit-msg`）を 1 回だけ呼んで行う。別実装は持たない。

gh の操作を 3 つに分ける。
- 素通し（読み取り）: `view`・`list`・`status`・`diff`・`checks`・`watch`・`download`・`checkout`、`gh search`、
  `--version`・`--help`、GET の `gh api`。
- 検査して通す: `gh issue create|edit|comment|close|reopen`、`gh pr create|edit|comment|review|close|reopen|merge`、
  `gh label create|edit`、`gh repo edit`、GET 以外の `gh api`。
- 止める: 上のどちらでもない操作（本人が実行する）。

検査する文字列は、識別子（`--repo`・エンドポイント・ユーザー名など）を除くすべての値と、
`--body-file`・`gh api` の `--input`・`-F key=@ファイル` が指すファイルの中身。
標準入力・変数・コマンド置換・存在しないファイル・解析できないコマンド・前に別のコマンドがつながった形は、
実行前に中身を確かめられないので止める。

範囲外（権限の確認に任せる）: スクリプトファイルの中身、本人のターミナル、`gh` 以外の経路。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

from block_hook_bypass import nested_commands, split_segments
from block_sensitive_paths import command_name, command_start, forward, top_level_lines

REPO_ROOT = Path(__file__).resolve().parents[2]
COMMIT_MSG = REPO_ROOT / ".githooks" / "commit-msg"
# フックの timeout（60 秒）より短くする。commit-msg は 1 回あたり約 2 秒
INSPECTION_TIMEOUT = 50
MAX_NESTING = 3

READ_VERBS = {"view", "list", "status", "diff", "checks", "watch", "download", "checkout"}
INSPECTED = {
    "issue": {"create", "edit", "comment", "close", "reopen"},
    "pr": {"create", "edit", "comment", "review", "close", "reopen", "merge"},
    "label": {"create", "edit"},
    "repo": {"edit"},
}
# 検査しない値（識別子）を取るオプション。ユーザー名やリポジトリ名を含みうる
IDENTIFIER_OPTIONS = {
    "--repo", "-R", "--hostname", "-H", "--header", "--head", "-X", "--method", "--jq", "-q", "--cache",
    "--assignee", "--add-assignee", "--remove-assignee", "--reviewer", "--add-reviewer", "--remove-reviewer",
}
# グループごとに、値を取るオプション。ここに無いオプションは値を取らないものとして読む（後ろの語は位置引数として検査される）。
# 値を取るのに載っていないものは安全側（検査が増える）、値を取らないのに載っているものは「次の語が `-` で始まるなら
# オプションとしても読む」（walk）で検査を逃れない。
TEXT_OPTIONS = {
    "--title", "-t", "--body", "-b", "--comment", "-c", "--reason", "--subject", "--label", "-l", "--add-label",
    "--remove-label", "--milestone", "-m", "--project", "-p", "--add-project", "--remove-project", "--base", "-B",
    "--template", "-T", "--author-email", "-A", "--match-head-commit", "--description", "-d", "--color", "--name",
    "-n", "--homepage", "--add-topic", "--remove-topic", "--default-branch", "--visibility",
    "--merge-commit-message", "--squash-merge-commit-message",
}
BODY_FILE_OPTIONS = {"--body-file", "-F"}
API_OPTIONS = {"-f", "--raw-field", "-F", "--field", "--input", "-t", "--template", "-p", "--preview"}
VALUE_OPTIONS = {
    "issue": IDENTIFIER_OPTIONS | TEXT_OPTIONS | BODY_FILE_OPTIONS,
    "pr": IDENTIFIER_OPTIONS | TEXT_OPTIONS | BODY_FILE_OPTIONS,
    "label": IDENTIFIER_OPTIONS | TEXT_OPTIONS,
    "repo": IDENTIFIER_OPTIONS | TEXT_OPTIONS,
    "api": IDENTIFIER_OPTIONS | API_OPTIONS,
}
API_FIELD_OPTIONS = {"-f", "--raw-field", "-F", "--field", "--input"}
API_TYPED_FIELD_OPTIONS = {"-F", "--field"}

HERE_STRING = re.compile(r"@['\"][ \t]*(?:\r?\n|$)")
# `$(…)`・バッククォート・プロセス置換は、分解がずれて後ろの値が検査を逃れうるので、識別子の中にあっても止める
INDIRECT = re.compile(r"\$\(|`|<\(|>\(")
DYNAMIC = ("$", "`", "<(")
NUMBER = re.compile(r"\d+")
# 値を取るのか、取らない（真偽の）オプションなのかが、サブコマンドによって違うもの。値が無くても止めない
AMBIGUOUS_OPTIONS = {"-d", "-c", "-m", "--comment", "--template"}
# gh を行の先頭でない位置に置ける書き方（`xargs gh …`・`{ gh …; }`・`if …; then gh …`・`Start-Process gh …`）を見つけるための語
KNOWN_GROUPS = set(VALUE_OPTIONS) | {
    "search", "release", "gist", "secret", "variable", "workflow", "run", "auth", "project", "codespace",
    "ruleset", "cache", "extension", "alias", "config", "ssh-key", "gpg-key", "org", "browse", "attestation",
}
LAUNCHERS = {"start-process", "start", "saps", "cmd", "invoke-expression", "iex", "invoke-command", "icm", "find", "parallel", "watch"}
# 引数の文字列そのものが gh のコマンドになる形（`iex 'gh …'`・`cmd /c "gh …"`）
STRING_COMMAND = re.compile(r"^\s*(?:&\s*)?(?:\S*[\\/])?gh(?:\.exe)?\s", re.IGNORECASE)
GH_WORD = re.compile(r"\bgh\b", re.IGNORECASE)

OUT_OF_SCOPE = "検査の対象外です。本人が実行してください。（検査できる gh の操作だけ Claude が実行します: docs/adr/0010）"
GUIDE = "文章を `work/` のファイルに書き、`--body-file <ファイル>` で渡してください。コマンドは 1 本ずつ分けてください。"


class Refusal(Exception):
    """検査できない、または検査の対象外なので止める。message をそのまま利用者に返す。"""


def cannot_inspect(reason: str) -> Refusal:
    return Refusal(f"公開する文章を検査できない形のため止めます（{reason}）。{GUIDE}")


@dataclass(frozen=True)
class Part:
    label: str  # 値の種類（`--title`・`--body-file`・位置引数）
    text: str
    filename: Optional[str] = None  # ファイルの中身のときのパス（見出しにだけ使う）


def walk(args: list[str], value_options: set[str]) -> Iterator[tuple[str, str, Optional[str]]]:
    """gh の引数を ("opt", オプション名, 値) と ("pos", "", 位置引数) の列にする。

    `-X POST`・`-XPOST`・`--method POST`・`--method=POST` を同じに扱う。短いオプションの束（`-sbX` は `-s -b X`）は、
    値を取らないものを飛ばして、値を取る最初のオプションに残りを値として渡す。値を取るオプションの次の語が `-` で始まる
    ときは、値としても、次のオプションとしても読む（値を取らないオプションを取ると誤って、後ろの `--body-file` を
    読み落とさないため）。
    """
    i = 0
    only_positional = False
    while i < len(args):
        token = args[i]
        i += 1
        if only_positional or token == "-" or not token.startswith("-"):
            yield "pos", "", token
            continue
        if token == "--":
            only_positional = True
            continue
        inline: Optional[str] = None
        if token.startswith("--"):
            name, equals, value = token.partition("=")
            if equals:
                inline = value
        else:
            chars = token[1:]
            name = "-" + chars[0]
            for position, char in enumerate(chars):
                if "-" + char in value_options:
                    name = "-" + char
                    rest = chars[position + 1 :]
                    inline = (rest[1:] if rest.startswith("=") else rest) or None
                    break
                yield "opt", "-" + char, None
            else:
                continue  # 値を取るオプションが無い束
        if inline is not None:
            yield "opt", name, inline
        elif name in value_options:
            if i < len(args):
                value = args[i]
                if not (value.startswith("-") and value != "-"):
                    i += 1
                yield "opt", name, value
            else:
                yield "opt", name, None
        else:
            yield "opt", name, None


def invocations(command: str, depth: int = 0, preceded: bool = False) -> Iterator[tuple[list[str], bool, bool]]:
    """gh の呼び出しを (gh より後ろの引数, 前に別のコマンドがつながっているか, 行の先頭でない位置にあるか) で返す。

    `sh -c` や `iex '…'` の中も調べる。行の先頭でない位置の gh は、前置きの種類が多く追いきれないので、
    読み取り以外なら呼び出し側が止める。
    """
    segments = [segment for line in top_level_lines(command) for segment in split_segments(line)]
    for index, segment in enumerate(segments):
        start = command_start(segment)
        after_other = preceded or index > 0
        if command_name(segment[start]) == "gh":
            yield segment[start + 1 :], after_other, False
            continue
        launcher = command_name(segment[start]) in LAUNCHERS
        for position in range(start + 1, len(segment)):
            following = segment[position + 1] if position + 1 < len(segment) else None
            if command_name(segment[position]) == "gh" and (launcher or following in KNOWN_GROUPS):
                yield segment[position + 1 :], True, True
        if depth < MAX_NESTING:
            for nested in nested_commands(segment):
                yield from invocations(nested, depth + 1, after_other)
            for token in segment[start + 1 :]:
                if STRING_COMMAND.match(token) or (launcher and GH_WORD.search(token) and any(c.isspace() for c in token)):
                    yield from invocations(token, depth + 1, after_other)


READ, INSPECT, FOREIGN = "read", "inspect", "foreign"


def api_method(args: list[str]) -> str:
    """`gh api` のメソッド。-X・--method の値、無ければフィールドか --input があれば POST、無ければ GET。"""
    method: Optional[str] = None
    has_fields = False
    for kind, name, value in walk(args[1:], VALUE_OPTIONS["api"]):
        if kind != "opt":
            continue
        if name in ("-X", "--method"):
            if value is None or any(mark in value for mark in DYNAMIC):
                raise cannot_inspect("HTTP メソッドを決められません")
            method = value.upper()
        elif name in API_FIELD_OPTIONS:
            has_fields = True
    return method or ("POST" if has_fields else "GET")


def classify(args: list[str]) -> str:
    if args == ["--version"]:
        return READ
    if "--help" in args and all(not a.startswith("-") for a in args if a != "--help"):
        return READ
    if not args or args[0].startswith("-"):
        return FOREIGN
    group = args[0]
    if group == "search":
        return READ
    if group == "api":
        return READ if api_method(args) == "GET" else INSPECT
    events = walk(args[1:], VALUE_OPTIONS.get(group, IDENTIFIER_OPTIONS))
    sub = next((value for kind, _, value in events if kind == "pos"), None)
    if sub in READ_VERBS:
        return READ
    return INSPECT if sub in INSPECTED.get(group, ()) else FOREIGN


def has_unquoted_parenthesis(text: str) -> bool:
    """引用符の外に `(` があるか。PowerShell の `(Get-Content …)`・`@(…)` は、値が実行時に決まる。"""
    quote = ""
    for char in text:
        if quote:
            quote = "" if char == quote else quote
        elif char in "'\"":
            quote = char
        elif char == "(":
            return True
    return False


def has_dynamic(text: str) -> bool:
    return any(mark in text for mark in DYNAMIC)


def read_file(path: str, option: str, cwd: str) -> Part:
    if path == "-":
        raise cannot_inspect("標準入力は検査できません")
    if has_dynamic(path):
        raise cannot_inspect("ファイルのパスに変数・コマンド置換があります")
    target = Path(path) if Path(path).is_absolute() else Path(cwd) / path
    try:
        text = target.read_bytes().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        raise cannot_inspect("指定されたファイルが無い・読めない・UTF-8 ではありません") from None
    return Part(option, text, path)


def is_identifier_like(value: str) -> bool:
    """位置引数の、数字だけの語と URL は、Issue や PR の指定で本人のユーザー名を含みうるので検査しない。
    空白を含む語は文章なので、URL で始まっていても検査する。"""
    if any(c.isspace() for c in value):
        return False
    return bool(NUMBER.fullmatch(value)) or value.startswith(("http://", "https://"))


def collect(args: list[str], cwd: str) -> list[Part]:
    """検査して通す操作から、検査する値とファイルの中身を集める。"""
    group = args[0]
    events = list(walk(args[1:], VALUE_OPTIONS[group]))
    first = next((n for n, event in enumerate(events) if event[0] == "pos"), None)
    skipped = set()
    if first is not None:
        skipped.add(first)  # サブコマンド（gh api ではエンドポイント）
        if group == "repo" and first + 1 < len(events) and events[first + 1][0] == "pos":
            skipped.add(first + 1)  # gh repo edit のリポジトリ指定
    parts = []
    for n, (kind, name, value) in enumerate(events):
        if n in skipped or name in IDENTIFIER_OPTIONS:
            continue
        if kind == "opt" and name == "--recover":
            raise cannot_inspect("--recover のファイルは検査できません")
        if value is None:
            if kind == "opt" and name in VALUE_OPTIONS[group] and name not in AMBIGUOUS_OPTIONS:
                raise cannot_inspect(f"{name} の値を読み取れません（PowerShell の括弧や式は、値として検査できません）")
            continue
        label = name if kind == "opt" else "位置引数"
        if kind == "opt" and name in BODY_FILE_OPTIONS and group in ("issue", "pr"):
            parts.append(read_file(value, name, cwd))
        elif kind == "opt" and group == "api" and name == "--input":
            parts.append(read_file(value, name, cwd))
        elif kind == "opt" and group == "api" and name in API_TYPED_FIELD_OPTIONS and "=@" in value:
            parts.append(read_file(value.partition("=@")[2], name, cwd))
        elif kind == "pos" and is_identifier_like(value):
            continue
        elif has_dynamic(value):
            raise cannot_inspect("値に変数・コマンド置換があります")
        else:
            parts.append(Part(label, value))
    return parts


def collect_parts(command: str, cwd: str, powershell: bool = False) -> list[Part]:
    if not GH_WORD.search(command):
        return []
    try:
        calls = list(invocations(command))
    except ValueError:
        raise cannot_inspect("コマンドを解析できません") from None
    kinds = [(args, preceded, misplaced, classify(args)) for args, preceded, misplaced in calls]
    if any(misplaced and kind != READ for _, _, misplaced, kind in kinds):
        raise cannot_inspect("gh がコマンドの先頭以外にあります。xargs・波括弧・if・Start-Process などの中は追えません")
    if any(kind == FOREIGN for _, _, _, kind in kinds):
        raise Refusal(OUT_OF_SCOPE)
    inspected = [(args, preceded) for args, preceded, _, kind in kinds if kind == INSPECT]
    if not inspected:
        return []
    if HERE_STRING.search(command):
        raise cannot_inspect("here-string は解析できません")
    if INDIRECT.search(command):
        raise cannot_inspect("変数・コマンド置換・プロセス置換があります")
    if powershell and has_unquoted_parenthesis(command):
        raise cannot_inspect("PowerShell の括弧（式の結果を値にする書き方）は、値を検査できません")
    parts: list[Part] = []
    for args, preceded in inspected:
        if preceded:
            raise cannot_inspect("前に別のコマンドがつながっています。ファイルの作成や cd の後は、実行前に確かめられません")
        parts.extend(collect(args, cwd))
    return parts


def build_inspection_text(parts: list[Part]) -> tuple[str, list[tuple[int, str]]]:
    """部分ごとの見出し行を挟んで 1 つの文字列にする。(全文, [(見出しの行番号, 表示用の名前)]) を返す。"""
    seen: dict[str, int] = {}
    lines: list[str] = []
    sections: list[tuple[int, str]] = []
    for part in parts:
        seen[part.label] = seen.get(part.label, 0) + 1
        label = part.label if seen[part.label] == 1 else f"{part.label}（{seen[part.label]} 番目）"
        sections.append((len(lines) + 1, label))
        lines.append(f"### {part.label}" + (f" {part.filename}" if part.filename else ""))
        body = part.text.replace("\r\n", "\n").replace("\r", "\n")
        lines.extend(body.split("\n")[: -1 if body.endswith("\n") else None])
    return "\n".join(lines) + "\n", sections


LOCATION = re.compile(r"コミットメッセージ:(\d+):")


def translate(stderr: str, sections: list[tuple[int, str]], temp_name: str) -> str:
    """commit-msg の指摘の行番号を、「`--body-file` の何行目」に直す。値とファイル名は出さない。"""

    def replace(match: re.Match) -> str:
        line = int(match.group(1))
        start, label = max((s for s in sections if s[0] <= line), default=(1, "検査する文章"))
        return f"{label} の見出し（ファイル名。相対パスで渡す）:" if line == start else f"{label} の {line - start} 行目:"

    return LOCATION.sub(replace, stderr.replace(temp_name, "<検査用の一時ファイル>")).strip()


def inspect(parts: list[Part], commit_msg: Path) -> Optional[str]:
    text, sections = build_inspection_text(parts)
    handle, name = tempfile.mkstemp(prefix="gh-write-", suffix=".md")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        try:
            result = subprocess.run(["sh", str(commit_msg), name], cwd=REPO_ROOT, capture_output=True, timeout=INSPECTION_TIMEOUT)
        except subprocess.TimeoutExpired:
            return "公開する文章の検査が時間内に終わらなかったため止めます。"
    finally:
        os.unlink(name)
    if result.returncode == 0:
        return None
    report = translate(result.stderr.decode("utf-8", errors="replace"), sections, name)
    return f"公開する文章の検査を通りません。直してから実行してください。\n{report}"


def check_command(command: str, cwd: str, tool_name: str = "Bash", commit_msg: Path = COMMIT_MSG) -> Optional[str]:
    """止めるときは利用者に返す文章を、通すときは None を返す。"""
    # split_segments は posix の引用解釈なので、PowerShell の `work\x.md` は `/` にしてパスを壊さないようにする
    text = forward(command) if tool_name == "PowerShell" else command
    try:
        parts = collect_parts(text, cwd, powershell=tool_name == "PowerShell")
    except Refusal as refusal:
        return str(refusal)
    return inspect(parts, commit_msg) if parts else None


def main() -> int:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    command = (payload.get("tool_input") or {}).get("command")
    if not isinstance(command, str):
        return 0
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    message = check_command(command, cwd, payload.get("tool_name") or "Bash")
    if message:
        print(message, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
