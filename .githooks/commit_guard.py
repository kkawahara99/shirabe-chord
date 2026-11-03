"""コミット前の検査のうち、gitleaks の実行以外を受け持つ。

- `private/` 配下のファイルがステージされていたら拒否する（docs/adr/0004）。
- ステージされた内容・パス名とコミットメッセージを、禁止語リストと照合する（docs/adr/0004）。
- gitleaks の検出結果を、一致した語を出さない形で表示する。

一致した語は出力しない。出すのはファイル名・行番号・ルール番号（禁止語リストの行番号）だけにし、
ファイル名そのものが禁止語に一致するときは、ファイル名も伏せて何番目のファイルかだけを出す。
"""

from __future__ import annotations

import argparse
import codecs
import json
import os
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Iterable, Optional, Sequence

DENYLIST_ENV = "SHIRABE_CHORD_DENYLIST"
DEFAULT_DENYLIST = PurePosixPath("private", "denylist.txt")
PRIVATE_DIR = "private"
# 追加・変更・リネーム・種類の変更。削除は検査しない（誤ってコミットしたファイルを外せるように）
INSPECTED_CHANGES = "ACMRT"
# 文字コードを判別できなくても止めない形式。バイト列のうち UTF-8 として読める部分（画像のメタデータなど）だけを照合する。
# PDF・書庫・Office 文書はここに入れない（作者名などが入りやすく、読めないなら止める）
RAW_SCAN_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf"})
GITLINK_MODE = "160000"
# 文字として読めても、これ以上の割合で制御文字・未割り当て・私用の文字があればバイナリとみなす
MAX_NON_TEXT_RATIO = 0.02
MESSAGE_LOCATION = "コミットメッセージ"
# ひらがな（U+3041〜3096・踊り字 U+309D〜309E）とカタカナ（U+30A1〜30F6・U+30FD〜30FE）の距離
KANA_OFFSET = 0x60
# 区切りを取り除いた照合に使う語の最短の長さ（取り除いた後）。短い語は単語をまたぐ偶然の一致が多すぎる
MIN_LOOSE_LENGTH_ASCII = 3
MIN_LOOSE_LENGTH_NON_ASCII = 2

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_SETUP_ERROR = 2


class DenylistUnavailable(Exception):
    """禁止語リストが無い、読めない、または有効な語が1つも無い。検査できないので通さない。"""


class Undecodable(Exception):
    """文字コードを判別できず、禁止語を照合できない。"""


@dataclass(frozen=True)
class Rule:
    number: int  # 禁止語リストの行番号
    term: str  # 正規化済みの語
    # 区切りを取り除いた照合に使う語。取り除くと短すぎる語は None（偶然の一致で無関係なものまで止めないため）
    loose_term: Optional[str] = field(init=False, compare=False, repr=False)

    def __post_init__(self) -> None:
        stripped = strip_separators(self.term)
        min_length = MIN_LOOSE_LENGTH_ASCII if stripped.isascii() else MIN_LOOSE_LENGTH_NON_ASCII
        object.__setattr__(self, "loose_term", stripped if len(stripped) >= min_length else None)


@dataclass(frozen=True)
class Hit:
    location: str  # 表示してよい形の場所（伏せる必要があれば伏せ済み）
    line: Optional[int]  # パス名での一致は None
    rule: int

    def __str__(self) -> str:
        where = f"{self.location}:{self.line}" if self.line is not None else f"{self.location} のパス名"
        return f"{where}: 禁止語ルール {self.rule}"


def normalize(text: str) -> str:
    """全角・半角、大文字・小文字、ひらがなとカタカナの違いを吸収する。"""
    return _hiragana_to_katakana(unicodedata.normalize("NFKC", text).casefold())


def _hiragana_to_katakana(text: str) -> str:
    return "".join(chr(ord(c) + KANA_OFFSET) if _is_hiragana(c) else c for c in text)


def _is_hiragana(char: str) -> bool:
    return "ぁ" <= char <= "ゖ" or "ゝ" <= char <= "ゞ"


def strip_separators(text: str) -> str:
    """空白・句読点・記号・制御文字・書式文字（ゼロ幅文字を含む）を取り除く。改行も取り除かれる。"""
    return "".join(c for c in text if unicodedata.category(c)[0] not in "ZPS" and unicodedata.category(c) not in ("Cc", "Cf"))


def parse_denylist(text: str) -> list[Rule]:
    """1行1語。空行と `#` で始まる行は無視する。"""
    rules = []
    for number, raw in enumerate(text.splitlines(), start=1):
        term = normalize(raw).strip()
        if term and not term.startswith("#"):
            rules.append(Rule(number, term))
    return rules


def load_denylist(path: Path) -> list[Rule]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        raise DenylistUnavailable(f"禁止語リストがありません: {path}") from None
    except UnicodeDecodeError:
        raise DenylistUnavailable(f"禁止語リストを UTF-8 として読めません。UTF-8 で保存してください: {path}") from None
    rules = parse_denylist(text)
    if not rules:
        raise DenylistUnavailable(f"禁止語リストに語がありません: {path}")
    return rules


def _looks_like_text(text: str) -> bool:
    if not text:
        return True
    non_text = sum(
        1 for c in text if c not in "\t\n\r\f" and unicodedata.category(c) in ("Cc", "Cn", "Co", "Cs")
    )
    return non_text / len(text) <= MAX_NON_TEXT_RATIO


def decode(data: bytes) -> str:
    """UTF-8・UTF-16・cp932（Shift_JIS）の順に、厳密に読めて文字らしいものを選ぶ。"""
    if data.startswith(codecs.BOM_UTF8):
        candidates = ["utf-8-sig"]
    elif data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        candidates = ["utf-16"]
    elif b"\0" in data:
        # BOM の無い UTF-16。ASCII の文字の側に NUL が来るので、NUL の多い位置で向きを決める
        candidates = ["utf-16-le" if data[1::2].count(0) >= data[0::2].count(0) else "utf-16-be"]
    else:
        candidates = ["utf-8", "cp932"]
    for encoding in candidates:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if _looks_like_text(text):
            return text
    raise Undecodable


def matching_rules(text: str, rules: Iterable[Rule]) -> list[int]:
    normalized = normalize(text)
    stripped = strip_separators(normalized)
    return [
        rule.number
        for rule in rules
        if rule.term in normalized or (rule.loose_term is not None and rule.loose_term in stripped)
    ]


def scan_text(location: str, text: str, rules: Sequence[Rule], loose: bool = True) -> list[Hit]:
    """一致した行とルールを返す。行をまたぐ一致は、一致の先頭の文字がある行にする。

    loose=False のときは、区切りを取り除く照合をしない。圧縮された画像やフォントのような
    ほぼ乱数のバイト列では、取り除くと英数字が詰まり、短い語が偶然一致しすぎるため。
    """
    found: set[tuple[int, int]] = set()
    joined: list[str] = []
    line_of_char: list[int] = []  # 区切りを取り除いた全文の各文字が、元の何行目にあったか
    for line_no, line in enumerate(text.splitlines(), start=1):
        normalized = normalize(line)
        found.update((line_no, rule.number) for rule in rules if rule.term in normalized)
        stripped = strip_separators(normalized)
        joined.append(stripped)
        line_of_char.extend([line_no] * len(stripped))

    whole = "".join(joined)
    for rule in rules if loose else ():
        if rule.loose_term is None:
            continue
        start = whole.find(rule.loose_term)
        while start != -1:
            found.add((line_of_char[start], rule.number))
            start = whole.find(rule.loose_term, start + 1)
    return [Hit(location, line_no, number) for line_no, number in sorted(found)]


def masked_label(index: int) -> str:
    return f"ステージされた {index} 番目のファイル（パス名に禁止語があるため伏せる）"


def display_path(path: str, index: int, rules: Sequence[Rule]) -> str:
    return masked_label(index) if matching_rules(path, rules) else path


def inspect_files(files: Sequence[tuple[str, Optional[bytes]]], rules: Sequence[Rule]) -> list[str]:
    """ステージされたファイル（パスと中身）を照合し、表示してよい形の指摘を返す。

    中身が None のもの（サブモジュール）はパス名だけを照合する。
    """
    problems: list[object] = []
    for index, (path, data) in enumerate(files, start=1):
        label = display_path(path, index, rules)
        problems.extend(Hit(label, None, number) for number in matching_rules(path, rules))
        if data is None:
            continue
        if PurePosixPath(path).suffix.casefold() in RAW_SCAN_SUFFIXES:
            problems.extend(scan_text(label, data.decode("utf-8", errors="ignore"), rules, loose=False))
            continue
        try:
            text = decode(data)
        except Undecodable:
            problems.append(f"{label}: 文字コードを判別できないため検査できません（UTF-8 のテキストにしてください）")
            continue
        problems.extend(scan_text(label, text, rules))
    return [str(p) for p in problems]


def private_paths(paths: Iterable[str]) -> list[str]:
    """`.gitignore` の `private/` と同じく、どの階層の `private` ディレクトリも対象にする。"""
    return [p for p in paths if PRIVATE_DIR in (part.casefold() for part in PurePosixPath(p).parts[:-1])]


def describe_gitleaks_findings(findings: Sequence[dict], rules: Optional[Sequence[Rule]]) -> list[str]:
    """gitleaks の検出から、ルールID・場所・行番号だけを取り出す。

    禁止語リストが読めないとき（rules が None）は、どのファイル名も伏せる。
    """
    lines = []
    for finding in findings:
        path = finding.get("File") or ""
        if not path:
            where = MESSAGE_LOCATION
        elif rules is None or matching_rules(path, rules):
            where = "（パス名を伏せたファイル）"
        else:
            where = path
        lines.append(f"{where}:{finding.get('StartLine')}: gitleaks ルール {finding.get('RuleID')}")
    return lines


def _git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def staged_paths(diff_filter: Optional[str] = None) -> list[str]:
    args = ["diff", "--cached", "--name-only", "-z"]
    if diff_filter:
        args.append(f"--diff-filter={diff_filter}")
    return [p.decode("utf-8") for p in _git(*args).split(b"\0") if p]


def staged_content(path: str, modes: dict[str, str]) -> Optional[bytes]:
    if modes.get(path) == GITLINK_MODE:
        return None
    return _git("show", f":{path}")


def staged_modes() -> dict[str, str]:
    modes = {}
    for entry in _git("ls-files", "--stage", "-z").split(b"\0"):
        if entry:
            meta, path = entry.split(b"\t", 1)
            modes[path.decode("utf-8")] = meta.split()[0].decode("ascii")
    return modes


def denylist_path() -> Path:
    """worktree から呼ばれても、メインの作業ツリーの `private/` を見る。"""
    if os.environ.get(DENYLIST_ENV):
        return Path(os.environ[DENYLIST_ENV])
    common_dir = _git("rev-parse", "--path-format=absolute", "--git-common-dir").decode("utf-8").strip()
    return Path(common_dir).parent / DEFAULT_DENYLIST


def _report(title: str, lines: Iterable[object]) -> None:
    print(f"commit-guard: {title}", file=sys.stderr)
    for line in lines:
        print(f"  {line}", file=sys.stderr)


def _load_rules() -> list[Rule]:
    try:
        return load_denylist(denylist_path())
    except DenylistUnavailable as e:
        _report(
            "禁止語の照合ができないため止めます",
            [e, f"README の「コミット前の検査」を参照して用意してください（場所は {DENYLIST_ENV} でも指定できる）"],
        )
        raise


def check_staged() -> int:
    status = EXIT_OK

    blocked = private_paths(staged_paths(diff_filter=INSPECTED_CHANGES))
    if blocked:
        _report(
            f"private/ のファイルが {len(blocked)} 件ステージされています。コミットできません",
            ["git restore --staged で外してください（ファイル名は禁止語を含みうるため出しません）"],
        )
        status = EXIT_VIOLATION

    try:
        rules = _load_rules()
    except DenylistUnavailable:
        return EXIT_SETUP_ERROR

    modes = staged_modes()
    files = [(path, staged_content(path, modes)) for path in staged_paths(diff_filter=INSPECTED_CHANGES)]
    problems = inspect_files(files, rules)
    if problems:
        _report(
            "禁止語が含まれているか、検査できないファイルがあります",
            problems
            + [
                "伏せたファイルは本人が git diff --cached --name-only の順番を目安に確かめる"
                "（git commit -a やパスを指定したコミットでは順番がずれることがある）"
            ],
        )
        status = EXIT_VIOLATION
    return status


def check_message(message_file: Path) -> int:
    try:
        rules = _load_rules()
    except DenylistUnavailable:
        return EXIT_SETUP_ERROR

    try:
        text = decode(message_file.read_bytes())
    except Undecodable:
        _report("コミットメッセージの文字コードを判別できないため検査できません", ["UTF-8 で書いてください"])
        return EXIT_VIOLATION
    hits = scan_text(MESSAGE_LOCATION, text, rules)
    if hits:
        _report("コミットメッセージに禁止語が含まれています", hits)
        return EXIT_VIOLATION
    return EXIT_OK


def report_gitleaks(report_file: Path) -> int:
    try:
        findings = json.loads(report_file.read_text(encoding="utf-8") or "null")
    except (OSError, ValueError):
        findings = None
    if not isinstance(findings, list) or not findings:
        _report("gitleaks が検出結果を出さずに失敗しました", ["gitleaks の設定（.gitleaks.toml）や引数を確認してください"])
        return EXIT_SETUP_ERROR

    try:
        rules: Optional[list[Rule]] = load_denylist(denylist_path())
    except DenylistUnavailable:
        rules = None
    _report("秘密情報・個人情報の形が含まれています（gitleaks）", describe_gitleaks_findings(findings, rules))
    return EXIT_VIOLATION


def main(argv: Optional[list[str]] = None) -> int:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("staged", help="ステージされた内容を検査する（pre-commit）")
    message = sub.add_parser("message", help="コミットメッセージを検査する（commit-msg）")
    message.add_argument("file", type=Path)
    gitleaks = sub.add_parser("gitleaks-report", help="gitleaks の JSON レポートを、語を出さない形で表示する")
    gitleaks.add_argument("file", type=Path)
    args = parser.parse_args(argv)

    try:
        if args.command == "staged":
            return check_staged()
        if args.command == "message":
            return check_message(args.file)
        return report_gitleaks(args.file)
    except subprocess.CalledProcessError as e:
        # 引数にパス名が入るので、コマンドの内容は出さない
        _report("git の実行に失敗したため止めます", [f"終了コード {e.returncode}"])
        return EXIT_SETUP_ERROR


if __name__ == "__main__":
    sys.exit(main())
