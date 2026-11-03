"""AWS公式アイコンを埋め込んで、構成図のHTMLを1ファイルに仕上げる。

元HTMLの中で `href="#aws-<アイコンのファイル名(拡張子なし)>"` と参照したアイコンだけを、
アイコンパッケージから探して <symbol> にし、`<!--AWS_ICON_SPRITE-->` の位置へ差し込む。
アイコンは <image> の data URI として埋め込む（アイコン側のidや属性がページと衝突しない）。
`<!--UNBUILT-->` から `<!--/UNBUILT-->` まで（ビルド前だけ見せる注意書き）は取り除く。
元HTMLに角丸（0 以外の <rect> の rx/ry や border-radius）があれば、行番号を出して止まる。

アイコンパッケージの場所は、次の順に探す。
  1. --icons <Icon-packageのzip か 展開したディレクトリ>
  2. 環境変数 AWS_ICON_PACKAGE（各自の .claude/settings.local.json の env に書く）
  3. リポジトリ直下の .cache/aws-icons/（zip を置くか、展開して置く。どこから実行しても同じ場所を見る）
     リポジトリ直下は、このファイルの3つ上（<リポ>/.claude/skills/<スキル名>/build.py）とする。

使い方:
  python3 -I build.py [--icons <場所>] --in <元HTML> --out <出力HTML>
"""

import argparse
import base64
import os
import pathlib
import re
import sys
import zipfile
from typing import Callable, Mapping, Optional

ICONS_ENV = "AWS_ICON_PACKAGE"
ICONS_DEFAULT_DIR = pathlib.Path(".cache/aws-icons")
_PARENTS = pathlib.Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else pathlib.Path.cwd()

REF = re.compile(r'href="#aws-([A-Za-z0-9_.\-]+)"')
VIEWBOX = re.compile(r'viewBox="([0-9.\s\-]+)"')
MARKER = "<!--AWS_ICON_SPRITE-->"
UNBUILT = re.compile(r"<!--UNBUILT-->.*?<!--/UNBUILT-->\n?", re.DOTALL)
RECT = re.compile(r"<rect\b[^>]*>", re.IGNORECASE)
RECT_RADIUS = re.compile(r"\b(?:rx|ry)\s*=\s*[\"']([^\"']*)[\"']", re.IGNORECASE)
BORDER_RADIUS = re.compile(r"border-radius\s*:\s*([^;}\"']*)", re.IGNORECASE)
ZERO = re.compile(r"0*\.?0*(px|em|rem|%)?|!important", re.IGNORECASE)


def resolve_icons(arg: Optional[pathlib.Path], env: Mapping[str, str], repo_root: pathlib.Path) -> pathlib.Path:
    """--icons、環境変数、既定の置き場所の順に、アイコンパッケージの場所を決める。"""
    if arg:
        return arg
    from_env = env.get(ICONS_ENV, "").strip()
    if from_env:
        return pathlib.Path(from_env).expanduser()
    return repo_root / ICONS_DEFAULT_DIR


def not_found(source: pathlib.Path) -> SystemExit:
    return SystemExit(
        f"アイコンパッケージが見つからない: {source}\n"
        f"  Icon-package の zip を {ICONS_DEFAULT_DIR}/ に置く、環境変数 {ICONS_ENV} で場所を指定する、"
        "または --icons で渡す"
    )


def index_icons(source: pathlib.Path) -> dict[str, tuple[str, Callable[[], str]]]:
    """アイコン名（拡張子なしのファイル名）から、表示用のパスと中身を読む関数への対応を作る。"""
    icons = {}
    if source.is_dir() and not any(p for p in source.rglob("*.svg") if "__MACOSX" not in p.parts):
        # svg が無く、直下に zip があるディレクトリは、いちばん新しい zip を使う
        zips = sorted(
            (p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".zip"),
            key=lambda p: (p.stat().st_mtime, p.name),
        )
        if zips:
            source = zips[-1]
    if source.is_file() and source.suffix.lower() == ".zip":
        archive = zipfile.ZipFile(source)
        for name in sorted(archive.namelist()):
            path = pathlib.PurePosixPath(name)
            if path.suffix.lower() != ".svg" or "__MACOSX" in path.parts:
                continue
            icons.setdefault(path.stem, (name, lambda n=name: archive.read(n).decode("utf-8")))
    elif source.is_dir():
        for path in sorted(source.rglob("*.svg")):
            if "__MACOSX" in path.parts:
                continue
            icons.setdefault(path.stem, (str(path.relative_to(source)), lambda p=path: p.read_text(encoding="utf-8")))
    else:
        raise not_found(source)
    if not icons:
        raise not_found(source)
    return icons


def symbol(name: str, text: str) -> str:
    match = VIEWBOX.search(text)
    if not match:
        sys.exit(f"viewBox が無いアイコン: {name}")
    _, _, width, height = match.group(1).split()
    data = base64.b64encode(text.encode("utf-8")).decode("ascii")
    return (
        f'<symbol id="aws-{name}" viewBox="0 0 {width} {height}">'
        f'<image width="{width}" height="{height}" href="data:image/svg+xml;base64,{data}"/>'
        f"</symbol>"
    )


def is_zero(value: str) -> bool:
    return all(ZERO.fullmatch(token) for token in value.split())


def rounded_corners(html: str) -> list[str]:
    found = []
    for number, line in enumerate(html.splitlines(), start=1):
        for rect in RECT.findall(line):
            if any(not is_zero(v) for v in RECT_RADIUS.findall(rect)):
                found.append(f"  {number} 行目: <rect> に 0 以外の rx/ry がある")
        if any(not is_zero(v) for v in BORDER_RADIUS.findall(line)):
            found.append(f"  {number} 行目: border-radius が 0 以外")
    return found


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--icons", type=pathlib.Path)
    parser.add_argument("--in", dest="src", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()

    html = args.src.read_text(encoding="utf-8")
    if html.count(MARKER) != 1:
        sys.exit(f"{MARKER} は元HTMLにちょうど1か所置く（いま {html.count(MARKER)} か所）")

    rounded = rounded_corners(html)
    if rounded:
        sys.exit("角丸がある（AWS構成図では角を立てる）:\n" + "\n".join(rounded))

    names = sorted(set(REF.findall(html)))
    icons = index_icons(resolve_icons(args.icons, os.environ, REPO_ROOT))
    missing = [n for n in names if n not in icons]
    if missing:
        sys.exit("見つからないアイコン: " + ", ".join(missing))

    sprite = (
        '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'
        + "".join(symbol(n, icons[n][1]()) for n in names)
        + "</defs></svg>"
    )
    args.out.write_text(UNBUILT.sub("", html).replace(MARKER, sprite), encoding="utf-8")
    print(f"{len(names)} 個のアイコンを埋め込んだ: {args.out}")
    for n in names:
        print(f"  {n}  <- {icons[n][0]}")


if __name__ == "__main__":
    main()
