"""Claude がホームの保護した場所（ダウンロード・資格情報・ブラウザのプロファイル）に触れる前に止める（PreToolUse）。

ダウンロードフォルダはネットから落としたものが入る場所で、読むこと自体が指示の混入の入口になる。
資格情報の置き場所は、読まれると漏れる。権限の deny ルールは文字列の前方一致で、`~` や `$HOME`・
`../..`・大文字小文字の違いを同じ場所として扱えない。ここではパスを解決してから比べる。

対象のツール: Bash・PowerShell（コマンドの各語）、Read・Edit・Write・NotebookEdit（ファイルのパス）、Glob・Grep（path と pattern・glob）。

止めるもの:
- 保護した場所そのもの、またはその下を指す語（`~/Downloads`・`$HOME\\.ssh`・`../../Downloads`・`/c/Users/<名前>/.aws`・`file:///C:/…` など）
- `*` や `{a,b}` を含む語で、保護した場所に当たりうるもの（`~/Down*`・`~/.ssh/id_*`・`~/{Downloads,x}`）
- 変数を展開できない語（`$X/Downloads`）に、保護した場所の名前が含まれるもの（空白を含む語は文章とみなして調べない）
- `cd` / `Set-Location` / `pushd` で保護した場所に入る形（その後の相対パスも追う）
- 保護した場所を含む上位の場所（ホームなど）を、再帰して探す操作の起点にしたもの
  （`find ~`・`rg x ~`・`ls -R ~`・`grep -r x ~`・`Get-ChildItem ~ -Recurse`、Glob・Grep の path）

調べないもの: `<<EOF` の本文、空白を含む語（コミットメッセージなど）。ただし語の中の `$(…)`・バッククォートの中身はコマンドとして調べる。

範囲外として通すもの（権限の確認に任せる）: スクリプトファイルの中身、`$(echo ~)/…` や `[Environment]::GetFolderPath(…)` のように
実行時に決まる場所、シンボリックリンクやジャンクション、`cmd` の `dir /s`、
`select-string -Recurse` のような、上に挙げていない再帰の探し方、`cp -r ~ …`・`tar`・`zip -r`・`rsync`・`robocopy` で
ホームを丸ごと写す操作、`sudo -u ユーザー` のようにオプションの値を取る前置き、`echo ~ | xargs find` のようにパイプで起点を渡す形。
`sudo`・`env`・`timeout` などの前置きは飛ばして調べる。再帰検索の検索語（grep・rg の最初の位置引数と `-e` の値）は起点とみなさない。
空白を含む語は、先頭が `~/` や `$HOME/` のときだけパスとして解決する（空白入りのパスを守るため。文章が `~/` で始まると止まる）。
"""

from __future__ import annotations

import fnmatch
import json
import os
import posixpath
import re
import sys
from typing import Optional

from block_hook_bypass import nested_commands, split_segments

# ホームからの相対パス。ホームの外で同じ名前のフォルダは対象にしない
PROTECTED = (
    "Downloads",
    "OneDrive/Downloads",
    ".ssh",
    ".aws",
    ".config/gh",
    ".config/gcloud",
    ".git-credentials",
    ".docker/config.json",
    ".kube",
    ".npmrc",
    ".terraform.d/credentials.tfrc.json",
    "AppData/Local/Google/Chrome",
    "AppData/Local/Microsoft/Edge",
    "AppData/Roaming/Mozilla",
)
CD_COMMANDS = {"cd", "chdir", "pushd", "push-location", "set-location", "sl"}
HOME_VARIABLES = re.compile(
    r"\$env:HOMEDRIVE\$env:HOMEPATH|%HOMEDRIVE%%HOMEPATH%|\$\{?(?:env:)?(?:HOME|USERPROFILE)\}?|%USERPROFILE%",
    re.IGNORECASE,
)
# `NAME=値`・`--option=値`・PowerShell の `-Path:値` の、値より前の部分（`C:/…` のドライブ文字は含めない）
ASSIGNMENT = re.compile(r"^(?:--?[A-Za-z][\w\-]*[=:]|[A-Za-z_]\w*=)(?=.)")
DRIVE_PATH = re.compile(r"^[A-Za-z]:/")
MSYS_DRIVE = re.compile(r"^/(?:mnt/)?([A-Za-z])(?=/|$)")
FILE_URL = re.compile(r"^file://(?:/(?=[A-Za-z]:))?", re.IGNORECASE)
BRACES = re.compile(r"\{([^{}]*,[^{}]*)\}")
# `<<EOF` から終端までの本文。見出しの行の残り（リダイレクトなど）は残す
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1(?P<rest>[^\n]*)\n.*?\n[ \t]*\2(?=[ \t]*(?:\n|$|\)|\"|'))", re.DOTALL)
SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
GLOB_CHARS = "*?["
MAX_NESTING = 3
MAX_BRACE_VARIANTS = 64

# 再帰して探すコマンド。grep・ls・Get-ChildItem は再帰を指定したときだけ
RECURSIVE_ALWAYS = {"find", "fd", "fdfind", "rg", "ag", "ack", "tree", "du"}
GREP_COMMANDS = {"grep", "egrep", "fgrep"}
CHILDITEM_COMMANDS = {"get-childitem", "gci", "dir"}
# 最初の位置引数が検索語になるコマンド（`-e`・`-f` で検索語を渡したときは、位置引数はすべて起点）
FD_COMMANDS = {"fd", "fdfind"}
PATTERN_COMMANDS = {"grep", "egrep", "fgrep", "rg", "ag", "ack"} | FD_COMMANDS
# 後ろの語がオプションの値で、起点ではないもの
OPTIONS_WITH_VALUE = {
    "-e", "--regexp", "-f", "--file", "-g", "--glob", "-t", "--type", "-T", "--type-not",
    "-m", "--max-count", "-A", "-B", "-C", "--context", "--include", "--exclude", "-name", "-iname", "-type",
}
# コマンドごとに値を取るオプション（`-r` は grep では再帰、rg では置換の文字列を取るなど、意味が違うため分ける）
OPTIONS_WITH_VALUE_BY_COMMAND = {
    "rg": {"-j", "--threads", "-d", "--max-depth", "-r", "--replace", "-E", "-M", "--sort", "--type-add"},
    "grep": {"--exclude-dir", "-D", "-d"},
    "fd": {"-d", "--max-depth", "-e", "--extension", "-E", "--exclude", "-t", "--type"},
    "fdfind": {"-d", "--max-depth", "-e", "--extension", "-E", "--exclude", "-t", "--type"},
}
# 実際のコマンドの前に置かれるもの
WRAPPER_COMMANDS = {"sudo", "env", "timeout", "command", "nice", "time", "nohup", "exec", "xargs"}

MESSAGE = (
    "ダウンロードフォルダ・資格情報の置き場所・ブラウザのプロファイルには触れません。"
    "ネットから落としたものが入る場所や、読まれると漏れるものがあるためです。"
    "必要なファイルは、本人がリポジトリの中（例: .cache/ や work/）に置きます。"
)

# ファイルを扱うツールの入力のうち、パスとして調べる項目。Grep の pattern は正規表現なので調べない
PATH_FIELDS = {
    "Read": ("file_path",),
    "Edit": ("file_path",),
    "Write": ("file_path",),
    "NotebookEdit": ("notebook_path",),
}


def forward(path: str) -> str:
    return path.replace("\\", "/")


def protected_paths(home: str) -> list[tuple[str, str]]:
    """(ホームからの相対パス, 比較用の絶対パス) の一覧。比較は小文字・スラッシュ区切りで行う。"""
    root = posixpath.normpath(forward(home)).casefold()
    return [(rel, posixpath.join(root, rel.casefold())) for rel in PROTECTED]


def expand_braces(word: str) -> list[str]:
    match = BRACES.search(word)
    if not match:
        return [word]
    variants: list[str] = []
    for alternative in match.group(1).split(","):
        variants.extend(expand_braces(word[: match.start()] + alternative + word[match.end() :]))
        if len(variants) >= MAX_BRACE_VARIANTS:
            break
    return variants[:MAX_BRACE_VARIANTS]


def resolve(word: str, home: str, base: str) -> Optional[str]:
    """語を、小文字・スラッシュ区切りの絶対パスにする。変数が残って決められなければ None。"""
    text = forward(word)
    text = FILE_URL.sub("", text)
    text = ASSIGNMENT.sub("", text, count=1)
    text = HOME_VARIABLES.sub(forward(home), text)
    if text.startswith("~"):
        if text != "~" and not text.startswith("~/"):
            return None  # `~ユーザー名/…`
        text = forward(home) + text[1:]
    text = MSYS_DRIVE.sub(lambda m: f"{m.group(1)}:", text)
    if re.fullmatch(r"[A-Za-z]:", text):
        text += "/"  # ドライブの直下（`C:` や `/c`）
    if "$" in text or "%" in text or "`" in text:
        return None
    if not (text.startswith("/") or DRIVE_PATH.match(text)):
        text = forward(base) + "/" + text
    return posixpath.normpath(text).casefold()


def hits_protected(resolved: str, home: str) -> Optional[str]:
    """解決済みのパスが保護した場所を指していれば、その名前を返す。"""
    has_glob = any(c in resolved for c in GLOB_CHARS)
    literal_head = re.split(r"[*?\[]", resolved, maxsplit=1)[0]
    for rel, absolute in protected_paths(home):
        if resolved == absolute or resolved.startswith(absolute + "/"):
            return rel
        if has_glob and (
            fnmatch.fnmatchcase(absolute, resolved)
            or fnmatch.fnmatchcase(absolute + "/x", resolved)
            or literal_head.startswith(absolute + "/")
        ):
            return rel
    return None


def contains_protected(resolved: str, home: str) -> Optional[str]:
    """解決済みのパスが、保護した場所を中に含む上位の場所（ホームなど）なら、含む場所の名前を返す。"""
    if resolved == "/":  # 現在のドライブの直下。ホームのドライブ文字つきの絶対パスとは前方一致しないので別に扱う
        return PROTECTED[0]
    prefix = resolved.rstrip("/") + "/"
    for rel, absolute in protected_paths(home):
        if absolute.startswith(prefix):
            return rel
    return None


def hits_by_name(word: str) -> Optional[str]:
    """変数を展開できない語に、保護した場所の名前が区切りつきで含まれていれば、その名前を返す。"""
    lowered = forward(word).casefold()
    for rel in PROTECTED:
        if re.search(r"(^|/)" + re.escape(rel.casefold()) + r"(/|$)", lowered):
            return rel
    return None


def check_word(word: str, home: str, base: str) -> Optional[str]:
    has_space = any(c.isspace() for c in word)
    for variant in expand_braces(word):
        resolved = resolve(variant, home, base)
        if resolved is not None:
            found = hits_protected(resolved, home)
        else:
            # 空白を含む語は文章（コミットメッセージなど）とみなし、名前だけでは止めない
            found = None if has_space else hits_by_name(variant)
        if found:
            return found
    return None


def command_name(token: str) -> str:
    name = re.split(r"[\\/]", token)[-1].casefold()
    return name[: -len(".exe")] if name.endswith(".exe") else name


def is_recursive(name: str, flags: list[str]) -> bool:
    if name in RECURSIVE_ALWAYS:
        return True
    short = [f[1:] for f in flags if not f.startswith("--")]
    if name in GREP_COMMANDS:
        return "--recursive" in flags or "--dereference-recursive" in flags or any(set("rR") & set(s) for s in short)
    if name == "ls":
        return "--recursive" in flags or any(f.casefold() == "-recurse" for f in flags) or any("R" in s for s in short)
    if name in CHILDITEM_COMMANDS:
        return any(f.casefold().startswith(("-r", "-depth")) for f in flags)
    return False


def command_start(segment: list[str]) -> int:
    """`sudo`・`env FOO=1`・`timeout 5` のような前置きを飛ばして、実際のコマンドの位置を返す。"""
    i = 0
    while i < len(segment) - 1 and (
        command_name(segment[i]) in WRAPPER_COMMANDS
        or ASSIGNMENT.match(segment[i])
        or re.fullmatch(r"-\w+|\d+[smhd]?", segment[i])
    ):
        i += 1
    return i


def search_roots(name: str, args: list[str]) -> list[str]:
    """再帰して探すコマンドの引数から、探索の起点にあたる語を取り出す（検索語や、オプションの値は除く）。"""
    roots: list[str] = []
    # `-e`・`-f` で検索語を渡したときや、`rg --files` のように検索語を取らないときは、位置引数はすべて起点
    has_pattern_option = name not in FD_COMMANDS and any(a in ("-e", "--regexp", "-f", "--file", "--files", "--type-list") for a in args)
    options_with_value = OPTIONS_WITH_VALUE | OPTIONS_WITH_VALUE_BY_COMMAND.get(name, set())
    skip_next = False
    pattern_pending = name in PATTERN_COMMANDS and not has_pattern_option
    for arg in args:
        if skip_next:
            skip_next = False
        elif arg in options_with_value:
            skip_next = True
        elif arg.startswith("-"):
            # PowerShell の `-Path:値`
            if name in CHILDITEM_COMMANDS and ":" in arg:
                roots.append(arg.split(":", 1)[1])
        elif pattern_pending:
            pattern_pending = False  # 最初の位置引数は検索語
        else:
            roots.append(arg)
    return roots


def broad_search(segment: list[str], home: str, base: str) -> Optional[str]:
    """ホームなど上位の場所を起点に再帰して探すコマンドなら、含まれる保護した場所の名前を返す。"""
    start = command_start(segment)
    name = command_name(segment[start])
    args = segment[start + 1 :]
    if not is_recursive(name, [t for t in args if t.startswith("-")]):
        return None
    roots = search_roots(name, args) or ["."]  # 起点を省いたときは、いまのディレクトリから探す
    for word in roots:
        resolved = resolve(word, home, base)
        found = contains_protected(resolved, home) if resolved else None
        if found:
            return found
    return None


def top_level_lines(text: str) -> list[str]:
    """引用符の外にある改行でコマンドを分ける（split_segments は改行を空白と同じに扱うため）。"""
    lines: list[str] = []
    current: list[str] = []
    quote = ""
    for char in text:
        if quote:
            quote = "" if char == quote else quote
        elif char in "'\"":
            quote = char
        elif char == "\n":
            lines.append("".join(current))
            current = []
            continue
        current.append(char)
    lines.append("".join(current))
    return [line for line in lines if line.strip()]


def find_in_command(command: str, home: str, cwd: str, depth: int = 0) -> Optional[str]:
    # split_segments は posix の引用解釈なので、`\` はあらかじめ `/` にしてパスを壊さないようにする
    text = HEREDOC.sub(lambda m: m.group("rest"), forward(command))
    try:
        segments = [segment for line in top_level_lines(text) for segment in split_segments(line)]
    except ValueError:
        # 解析できないコマンドは、語の区切りだけで粗く調べる
        lines = [[w.strip("\"'") for w in part.split()] for part in re.split(r"[;&|\n]+", text)]
        words = [w for line in lines for w in line]
        found = next((f for w in words if (f := check_word(w, home, cwd))), None)
        return found or next((f for line in lines if line and (f := broad_search(line, home, cwd))), None)
    here = cwd
    for segment in segments:
        for word in segment:
            found = check_word(word, home, here)
            if found:
                return found
            if depth < MAX_NESTING and any(c.isspace() for c in word):
                for match in SUBSTITUTION.finditer(word):
                    found = find_in_command(match.group(1) or match.group(2), home, here, depth + 1)
                    if found:
                        return found
        found = broad_search(segment, home, here)
        if found:
            return found
        if depth < MAX_NESTING:
            for nested in nested_commands(segment):
                found = find_in_command(nested, home, here, depth + 1)
                if found:
                    return found
        if segment[0].casefold() in CD_COMMANDS:
            target = resolve(segment[1], home, here) if len(segment) >= 2 else forward(home).casefold()
            if target is not None:
                here = target
    return None


def find_in_search_tool(payload: dict, home: str, cwd: str) -> Optional[str]:
    """Glob・Grep の入力を調べる。pattern・glob は path を基準に解決し、path が上位の場所なら止める。"""
    tool_input = payload.get("tool_input") or {}
    base = cwd
    path = tool_input.get("path")
    if isinstance(path, str) and path:
        found = check_word(path, home, cwd)
        resolved = resolve(path, home, cwd)
        if found or resolved is None:
            return found
        found = contains_protected(resolved, home)
        if found:
            return found
        base = resolved
    field = "pattern" if payload.get("tool_name") == "Glob" else "glob"
    value = tool_input.get(field)
    if not (isinstance(value, str) and value):
        return None
    found = check_word(value, home, base)
    resolved = resolve(value, home, base)
    if found or resolved is None or not any(c in resolved for c in GLOB_CHARS):
        return found
    # `~/**/*.zip` のように、ワイルドカードより前が保護した場所を含む上位の場所なら、path を省いても止める
    head = re.split(r"[*?\[]", resolved, maxsplit=1)[0]
    return contains_protected(head if head.endswith("/") else posixpath.dirname(head), home)


def find_sensitive(payload: dict, home: str, cwd: str) -> Optional[str]:
    """ツールの入力に保護した場所への参照があれば、その名前を返す。"""
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command")
    if isinstance(command, str):
        return find_in_command(command, home, cwd)
    if payload.get("tool_name") in ("Glob", "Grep"):
        return find_in_search_tool(payload, home, cwd)
    fields = PATH_FIELDS.get(payload.get("tool_name"), ())
    values = [tool_input.get(key) for key in fields]
    return next((found for v in values if isinstance(v, str) and v and (found := check_word(v, home, cwd))), None)


def main() -> int:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    found = find_sensitive(payload, os.path.expanduser("~"), cwd)
    if found:
        print(f"{MESSAGE}（検出: ホームの {found}）", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
