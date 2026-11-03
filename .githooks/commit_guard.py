"""コミット前の検査のうち、gitleaks の実行以外を受け持つ。

- `private/` 配下のファイルがステージされていたら拒否する（docs/adr/0004）。
- ステージされた内容・パス名とコミットメッセージを、禁止語リストと照合する（docs/adr/0004）。
- push する範囲のコミットと履歴全体を、同じ基準で検査する（docs/adr/0011）。
  メッセージ・作者とコミッター・追加されたファイルのパス名と中身・ref 名が対象。
- gitleaks の検出結果を、一致した語を出さない形で表示する。

一致した語は出力しない。出すのはファイル名・行番号・ルール番号（禁止語リストの行番号）だけにし、
ファイル名そのものが禁止語に一致するときは、ファイル名も伏せて何番目のファイルかだけを出す。
"""

from __future__ import annotations

import argparse
import codecs
import json
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable, NamedTuple, Optional, Sequence

DENYLIST_ENV = "SHIRABE_CHORD_DENYLIST"
DEFAULT_DENYLIST = PurePosixPath("private", "denylist.txt")
PRIVATE_DIR = "private"
# 追加・変更・リネーム・種類の変更。削除は検査しない（誤ってコミットしたファイルを外せるように）
INSPECTED_CHANGES = "ACMRT"
# 文字コードを判別できなくても止めない形式。バイト列のうち UTF-8 として読める部分（画像のメタデータなど）だけを照合する。
# PDF・書庫・Office 文書はここに入れない（作者名などが入りやすく、読めないなら止める）
RAW_SCAN_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf"})
# pnpm のロックファイル。integrity の値（ほぼ乱数の base64）を取り除いてから照合する（docs/adr/0013）
LOCKFILE_NAME = "pnpm-lock.yaml"
# SRI（W3C のサブリソース完全性）の値。下限の 27 字は SHA-1 の base64（28 字）に合わせ、`sha1-` で始まるパッケージ名を消さないため。
# 前に英数字・`+`・`/`・`-` が続くもの（パッケージ名や URL の途中）は値とみなさない
SRI_VALUE = re.compile(r"(?<![A-Za-z0-9+/-])sha(?:1|256|384|512)-[A-Za-z0-9+/]{27,}={0,2}")
GITLINK_MODE = "160000"
# 文字として読めても、これ以上の割合で制御文字・未割り当て・私用の文字があればバイナリとみなす
MAX_NON_TEXT_RATIO = 0.02
MESSAGE_LOCATION = "コミットメッセージ"
# ひらがな（U+3041〜3096・踊り字 U+309D〜309E）とカタカナ（U+30A1〜30F6・U+30FD〜30FE）の距離
KANA_OFFSET = 0x60
# 区切りを取り除いた照合に使う語の最短の長さ（取り除いた後）。短い語は単語をまたぐ偶然の一致が多すぎる
MIN_LOOSE_LENGTH_ASCII = 3
MIN_LOOSE_LENGTH_NON_ASCII = 2
SHORT_HASH_LENGTH = 8
# 履歴全体の再照合の対象。refs/stash は含めない（公開されない）
HISTORY_REVS = ("--branches", "--tags", "--remotes")
# 先頭の `<数字>+` も許す。GitHub のユーザー名に `+` は使えない
NOREPLY_EMAIL = re.compile(r"(?:\d+\+)?([^@\s<>+]+)@users\.noreply\.github\.com", re.IGNORECASE)
# GitHub の Web 画面でマージしたときのコミッター（メールは小文字にして比べる）
GITHUB_COMMITTER = ("GitHub", "noreply@github.com")
IDENTITY_HINT = "<ユーザー名>@users.noreply.github.com の形のメールと、そのユーザー名と同じ名前"
IDENT_LINE = re.compile(rb"(author|committer) (.*) <([^<>]*)> \d+ [+-]\d{4}")
OBJECT_ID = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")

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


def inspect_files(
    files: Sequence[tuple[str, Optional[bytes]]],
    rules: Sequence[Rule],
    *,
    labeler: Optional[Callable[[int, str], str]] = None,
    check_path: bool = True,
) -> list[str]:
    """ファイル（パスと中身）を照合し、表示してよい形の指摘を返す。

    中身が None のもの（サブモジュール）はパス名だけを照合する。
    labeler は表示する場所の名前（引数は何番目かとパス）。無ければ、パスを（必要なら伏せて）出す。
    check_path=False は、パス名を別に照合済みのとき（パスは画像かどうかの判別にだけ使う）。
    """
    problems: list[object] = []
    for index, (path, data) in enumerate(files, start=1):
        label = labeler(index, path) if labeler else display_path(path, index, rules)
        if check_path:
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
        if PurePosixPath(path).name == LOCKFILE_NAME:
            text = SRI_VALUE.sub("", text)  # 行の中だけで消えるので、行番号は変わらない
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
        commit = (finding.get("Commit") or "")[:SHORT_HASH_LENGTH]
        prefix = f"{commit} " if commit else ""
        lines.append(f"{prefix}{where}:{finding.get('StartLine')}: gitleaks ルール {finding.get('RuleID')}")
    return lines


def identity_allowed(name: str, email: str, committer: bool = False) -> bool:
    """作者・コミッターの名前とメールが、公開してよい GitHub のユーザー名の形か。

    メールが `<ユーザー名>@users.noreply.github.com`（先頭の `<数字>+` は可）で、名前がそのユーザー名と同じ
    （大文字小文字は区別しない）。コミッターだけは、GitHub の Web 画面でマージしたときの組も許す。
    """
    match = NOREPLY_EMAIL.fullmatch(email)
    if match and match.group(1).casefold() == name.casefold():
        return True
    return committer and (name, email.casefold()) == GITHUB_COMMITTER


class Commit(NamedTuple):
    author: tuple[str, str]  # 名前, メール
    committer: tuple[str, str]
    message: bytes  # コミット時の文字コードのまま


def parse_commit(raw: bytes) -> Commit:
    """`git cat-file commit` の出力を、作者・コミッター・メッセージに分ける。"""
    head, _, message = raw.partition(b"\n\n")
    idents = {"author": ("", ""), "committer": ("", "")}
    for line in head.split(b"\n"):
        match = IDENT_LINE.fullmatch(line)
        if match:
            role, name, email = (g.decode("utf-8", errors="replace") for g in match.groups())
            idents[role] = (name, email)
    return Commit(idents["author"], idents["committer"], message)


def inspect_identities(short: str, commit: Commit) -> list[str]:
    """名前とメールは出さない。公開してよいユーザー名が入る欄なので、禁止語の照合はかけない。"""
    return [
        f"{short} {role}: 名前とメールが、{IDENTITY_HINT}ではありません（名前とメールは伏せる）"
        for role, (name, email), is_committer in (
            ("作者", commit.author, False),
            ("コミッター", commit.committer, True),
        )
        if not identity_allowed(name, email, committer=is_committer)
    ]


def describe_commit_paths(short: str, paths: Iterable[str], rules: Sequence[Rule]) -> list[str]:
    """コミットで追加・変更されたパス名を照合する。一致したパス名は伏せ、何番目かだけを示す。"""
    lines = []
    for index, path in enumerate(dict.fromkeys(paths), start=1):
        label = f"{short} の {index} 番目のファイル（パス名に禁止語があるため伏せる）"
        lines.extend(str(Hit(label, None, number)) for number in matching_rules(path, rules))
    return lines


def inspect_ref_names(refs: Iterable[str], rules: Sequence[Rule]) -> list[str]:
    """ref の名前を照合する。名前は伏せ、ブランチかタグかだけを示す（pre-push は ref を 1 つずつ渡すので番号は使えない）。"""
    kinds = (("refs/heads/", "ブランチ"), ("refs/tags/", "タグ"))
    return [
        f"送る{next((kind for prefix, kind in kinds if ref.startswith(prefix)), ' ref')}の名前に禁止語があります（名前は伏せる）: 禁止語ルール {number}"
        for ref in refs
        for number in matching_rules(ref, rules)
    ]


def message_text(message: bytes) -> str:
    """gitleaks に渡す用。文字コードを判別できなくても止めず、読める範囲で渡す。"""
    try:
        return decode(message)
    except Undecodable:
        return message.decode("utf-8", errors="replace")


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


def commits_in(revs: Sequence[str]) -> list[str]:
    return _git("rev-list", *revs).decode("ascii").split()


def commit_paths(commit: str) -> list[str]:
    """コミットで追加・変更・リネーム・コピー・型変更されたパス名。マージコミットは親ごとの差分を見る。"""
    out = _git(
        "diff-tree", "-r", "--root", "-m", "--no-commit-id",
        f"--diff-filter={INSPECTED_CHANGES}", "--name-only", "-z", commit,
    )
    return [p.decode("utf-8", errors="replace") for p in out.split(b"\0") if p]


def _git_with_input(args: Sequence[str], text: str) -> bytes:
    return subprocess.run(["git", *args], input=text.encode("ascii"), check=True, capture_output=True).stdout


def new_blobs(revs: Sequence[str]) -> list[tuple[str, str, bytes]]:
    """範囲で新しく入るファイルの（オブジェクトID, パス, 中身）。

    同じ中身は1つにまとまり、パスはそのうちの1つ（リネームの新しい名前は commit_paths で見る）。
    """
    paths: dict[str, str] = {}
    for line in _git("rev-list", "--objects", *revs).decode("utf-8", errors="replace").splitlines():
        object_id, _, path = line.partition(" ")
        if OBJECT_ID.fullmatch(object_id) and path:
            paths.setdefault(object_id, path)
    if not paths:
        return []
    types = _git_with_input(["cat-file", "--batch-check=%(objecttype) %(objectname)"], "\n".join(paths) + "\n")
    blob_ids = [line.split()[1] for line in types.decode("ascii").splitlines() if line.startswith("blob ")]
    if not blob_ids:
        return []
    out = _git_with_input(["cat-file", "--batch"], "\n".join(blob_ids) + "\n")
    blobs, pos = [], 0
    for _ in blob_ids:
        header_end = out.index(b"\n", pos)
        object_id, _type, size = out[pos:header_end].decode("ascii").split()
        start = header_end + 1
        blobs.append((object_id, paths[object_id], out[start : start + int(size)]))
        pos = start + int(size) + 1
    return blobs


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


def check_commits(revs: Sequence[str], refs: Sequence[str], title: str) -> int:
    """範囲 revs のコミットすべてと、送る ref の名前を検査する。"""
    try:
        rules = _load_rules()
    except DenylistUnavailable:
        return EXIT_SETUP_ERROR

    problems: list[object] = list(inspect_ref_names(refs, rules))
    for commit_id in commits_in(revs):
        short = commit_id[:SHORT_HASH_LENGTH]
        commit = parse_commit(_git("cat-file", "commit", commit_id))
        problems.extend(inspect_identities(short, commit))
        try:
            text = decode(commit.message)
        except Undecodable:
            problems.append(f"{short} コミットメッセージの文字コードを判別できないため検査できません")
        else:
            problems.extend(scan_text(f"{short} {MESSAGE_LOCATION}", text, rules))
        problems.extend(describe_commit_paths(short, commit_paths(commit_id), rules))

    blobs = new_blobs(revs)
    blob_problems = inspect_files(
        [(path, data) for _id, path, data in blobs],
        rules,
        labeler=lambda index, _path: f"blob {blobs[index - 1][0][:SHORT_HASH_LENGTH]}",
        check_path=False,  # パス名はコミットごとに照合済み
    )
    problems.extend(blob_problems)
    if not problems:
        return EXIT_OK
    if blob_problems:
        problems.append("blob は git log --all --find-object=<ハッシュ> で、入れたコミットを探せる")
    _report(title, problems)
    return EXIT_VIOLATION


def print_messages(revs: Sequence[str]) -> int:
    """範囲のコミットメッセージを、gitleaks stdin に渡す1つの入力にして標準出力へ出す。"""
    texts = [message_text(parse_commit(_git("cat-file", "commit", c)).message) for c in commits_in(revs)]
    sys.stdout.buffer.write("\n\n".join(texts).encode("utf-8"))
    return EXIT_OK


def report_gitleaks(report_file: Path, label: str = "") -> int:
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
    title = "秘密情報・個人情報の形が含まれています（gitleaks）"
    _report(f"{label}: {title}" if label else title, describe_gitleaks_findings(findings, rules))
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
    gitleaks.add_argument("--label", default="", help="どのコミットの結果かを示す見出し")
    pushed = sub.add_parser("range", help="push する範囲のコミットを検査する（pre-push）。rev-list の引数は -- の後ろに渡す")
    pushed.add_argument("--ref", action="append", default=[], help="送る ref の名前")
    pushed.add_argument("revs", nargs="+")
    sub.add_parser("history", help="履歴全体（ブランチ・タグ・リモート追跡ブランチ）を再照合する（scan-history）")
    messages = sub.add_parser("messages", help="範囲のコミットメッセージを1つにまとめて出す（gitleaks stdin に渡す用）")
    messages.add_argument("revs", nargs="+")
    args = parser.parse_args(argv)

    try:
        if args.command == "staged":
            return check_staged()
        if args.command == "message":
            return check_message(args.file)
        if args.command == "gitleaks-report":
            return report_gitleaks(args.file, args.label)
        if args.command == "range":
            return check_commits(args.revs, args.ref, "送るコミットに問題があります。push できません")
        if args.command == "history":
            return check_commits(HISTORY_REVS, [], "履歴に問題があります")
        return print_messages(args.revs)
    except subprocess.CalledProcessError as e:
        # 引数にパス名が入るので、コマンドの内容は出さない
        _report("git の実行に失敗したため止めます", [f"終了コード {e.returncode}"])
        return EXIT_SETUP_ERROR


if __name__ == "__main__":
    sys.exit(main())
