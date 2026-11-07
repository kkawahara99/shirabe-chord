"""テスト 1 件の時間の上限（vitest の既定 5 秒）を、延長や緩和で外させないための検査。

TypeScript を読み込むライブラリは使わず、字句に分けて読む（標準ライブラリだけで動かすため。test_workflows.py と同じ）。
文字列・テンプレート文字列・正規表現・コメントの中は、中身を見ずに 1 つの塊として飛ばす。

守る理由は docs/adr/0034-cap-each-test-at-five-seconds.md。ワークフローの安全の条件（test_workflows.py）とは
守るものが違うので、別のファイルに置く。
"""

import json
import re
import tempfile
import unittest
from pathlib import Path
from typing import NamedTuple

from test_workflows import WORKFLOWS_DIR, run_blocks

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIRS = [ROOT / "apps" / "web" / "src", ROOT / "packages" / "core" / "src"]
PACKAGE_JSONS = [ROOT / "package.json", ROOT / "apps" / "web" / "package.json", ROOT / "packages" / "core" / "package.json"]
# 上限を明示する設定ファイル（web は vite.config.ts の test、core は vitest.config.ts）
CONFIG_FILES = [ROOT / "apps" / "web" / "vite.config.ts", ROOT / "packages" / "core" / "vitest.config.ts"]
MAX_TIMEOUT_MS = 5000

# --- 字句に分ける ---------------------------------------------------------------


class Tok(NamedTuple):
    kind: str  # id / num / str / tpl / re / p（記号）
    value: str
    line: int


IDENT = re.compile(r"[A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*")
NUMBER = re.compile(r"(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?")
# これらの直後の / は割り算でなく正規表現の始まり
REGEX_AFTER_KEYWORD = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"}
OPEN, CLOSE = {"(", "[", "{"}, {")", "]", "}"}


def regex_allowed(tokens: list[Tok]) -> bool:
    if not tokens:
        return True
    last = tokens[-1]
    if last.kind in ("num", "str", "tpl", "re"):
        return False
    if last.kind == "id":
        return last.value in REGEX_AFTER_KEYWORD
    # `</div>` の / と、閉じ括弧の後の割り算は正規表現にしない
    return last.value not in CLOSE | {"<"}


def regex_end(text: str, pos: int) -> int | None:
    """`text[pos]` が `/` のとき、正規表現リテラルの終わりの次の位置。正規表現でなければ None。"""
    i, in_class = pos + 1, False
    while i < len(text):
        ch = text[i]
        if ch == "\n":
            return None
        if ch == "\\":
            i += 2
            continue
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            i += 1
            while i < len(text) and text[i].isalpha():
                i += 1
            return i
        i += 1
    return None


def scan_template(text: str, pos: int, line: int) -> tuple[int, int]:
    """`pos` はバッククォートの次。閉じたバッククォートの次の位置と行を返す。`${ }` の中は入れ子で読む。"""
    while pos < len(text):
        ch = text[pos]
        if ch == "\\":
            pos += 2
        elif ch == "`":
            return pos + 1, line
        elif text.startswith("${", pos):
            _, pos, line = scan(text, pos + 2, line, True)
        else:
            line += ch == "\n"
            pos += 1
    return pos, line


def scan(text: str, pos: int, line: int, until_close_brace: bool) -> tuple[list[Tok], int, int]:
    tokens: list[Tok] = []
    depth = 0
    n = len(text)
    while pos < n:
        ch = text[pos]
        if ch == "\n":
            line += 1
            pos += 1
        elif ch.isspace():
            pos += 1
        elif text.startswith("//", pos):
            end = text.find("\n", pos)
            pos = n if end < 0 else end
        elif text.startswith("/*", pos):
            end = text.find("*/", pos + 2)
            end = n if end < 0 else end + 2
            line += text.count("\n", pos, end)
            pos = end
        elif ch in "\"'":
            # 閉じ忘れ（JSX の本文のアポストロフィなど）で後ろを巻き込まないよう、行末で止める
            i = pos + 1
            while i < n and text[i] not in (ch, "\n"):
                i += 2 if text[i] == "\\" else 1
            tokens.append(Tok("str", text[pos + 1 : i], line))
            pos = min(i + 1, n) if i < n and text[i] == ch else i
        elif ch == "`":
            start_line = line
            pos, line = scan_template(text, pos + 1, line)
            tokens.append(Tok("tpl", "", start_line))
        elif ch == "/" and regex_allowed(tokens) and (end := regex_end(text, pos)) is not None:
            tokens.append(Tok("re", "", line))
            pos = end
        elif m := IDENT.match(text, pos):
            tokens.append(Tok("id", m.group(), line))
            pos = m.end()
        elif m := NUMBER.match(text, pos):
            tokens.append(Tok("num", m.group(), line))
            pos = m.end()
        elif text.startswith("=>", pos):
            tokens.append(Tok("p", "=>", line))
            pos += 2
        else:
            if ch == "{":
                depth += 1
            elif ch == "}":
                if until_close_brace and depth == 0:
                    return tokens, pos + 1, line
                depth -= 1
            tokens.append(Tok("p", ch, line))
            pos += 1
    return tokens, pos, line


def tokenize(text: str) -> list[Tok]:
    return scan(text, 0, 1, False)[0]


def is_punct(token: Tok, *values: str) -> bool:
    return token.kind == "p" and token.value in values


# --- テストファイルの個別の上限 --------------------------------------------------

SUITE_ROOTS = {"it", "test", "describe", "suite"}
# onTestFinished・onTestFailed も、第 2 引数で時間を取る
HOOK_ROOTS = {"beforeEach", "beforeAll", "afterEach", "afterAll", "onTestFinished", "onTestFailed"}


def call_arguments(tokens: list[Tok], i: int) -> tuple[list[list[Tok]], int]:
    """`tokens[i]` は `(`。引数ごとの字句と、閉じ括弧の次の位置を返す。"""
    depth, args, current = 0, [], []
    for j in range(i, len(tokens)):
        token = tokens[j]
        if is_punct(token, *OPEN):
            depth += 1
            if depth == 1:
                continue
        elif is_punct(token, *CLOSE):
            depth -= 1
            if depth == 0:
                if current:
                    args.append(current)
                return args, j + 1
        elif is_punct(token, ",") and depth == 1:
            args.append(current)
            current = []
            continue
        current.append(token)
    return args, len(tokens)


def skip_type_arguments(tokens: list[Tok], i: int) -> int | None:
    """`tokens[i]` は `<`。型引数 `<…>` の次の位置。`(` が続かなければ型引数とみなさず None。"""
    depth = 0
    for j in range(i, len(tokens)):
        token = tokens[j]
        if is_punct(token, "<"):
            depth += 1
        elif is_punct(token, ">"):
            depth -= 1
            if depth == 0:
                return j + 1 if j + 1 < len(tokens) and is_punct(tokens[j + 1], "(") else None
        elif is_punct(token, ";"):
            return None
    return None


def call_chain(tokens: list[Tok], i: int) -> list[list[Tok]] | None:
    """`tokens[i]` から続く呼び出しの連鎖（`.skip`・`.each<型>(表)`・`(…)(…)`）のうち、最後の呼び出しの引数。呼び出しが無ければ None。"""
    last, j = None, i + 1
    while j < len(tokens):
        token = tokens[j]
        if is_punct(token, ".") and j + 1 < len(tokens) and tokens[j + 1].kind == "id":
            j += 2
        elif is_punct(token, "<") and (after := skip_type_arguments(tokens, j)) is not None:
            j = after
        elif token.kind == "tpl" and j > i + 1:
            j += 1  # `it.each`表`(…)` のタグ付きテンプレートの表も 1 段の呼び出し
        elif is_punct(token, "("):
            last, j = call_arguments(tokens, j)
        else:
            break
    return last


def has_timeout_key(arg: list[Tok]) -> bool:
    """引数がオブジェクトのリテラルで、その直下に `timeout` のキーがある。"""
    if not arg or not is_punct(arg[0], "{"):
        return False
    depth = 0
    for k, token in enumerate(arg):
        if is_punct(token, *OPEN):
            depth += 1
        elif is_punct(token, *CLOSE):
            depth -= 1
        elif depth == 1 and token.kind in ("id", "str") and token.value == "timeout":
            if is_punct(arg[k - 1], "{", ",") and k + 1 < len(arg) and is_punct(arg[k + 1], ":", ",", "}"):
                return True
    return False


def check_test_source(text: str) -> list[str]:
    """個別の延長・上限の緩和の書き方を見つける。"""
    tokens = tokenize(text)
    problems = []
    for i, token in enumerate(tokens):
        if token.kind != "id":
            continue
        after_dot = i > 0 and is_punct(tokens[i - 1], ".")
        if token.value in ("vi", "vitest") and i + 2 < len(tokens) and is_punct(tokens[i + 1], ".") and tokens[i + 2].value == "setConfig":
            problems.append(f"{token.line}行目: {token.value}.setConfig で設定を変えている")
        if after_dot or token.value not in SUITE_ROOTS | HOOK_ROOTS:
            continue
        args = call_chain(tokens, i)
        if args is None:
            continue
        if token.value in HOOK_ROOTS and len(args) >= 2:
            problems.append(f"{token.line}行目: {token.value} に第 2 引数（時間の指定）がある")
        if token.value in SUITE_ROOTS:
            if len(args) >= 3:
                problems.append(f"{token.line}行目: {token.value} に第 3 引数（時間の指定）がある")
            if any(has_timeout_key(arg) for arg in args):
                problems.append(f"{token.line}行目: {token.value} に {{ timeout }} を渡している")
    return problems


# --- コマンド -------------------------------------------------------------------

SHELL_SPLIT = re.compile(r"&&|\|\||;|\||\n")
TIMEOUT_OPTION = re.compile(r"^--(?:testTimeout|hookTimeout|test-timeout|hook-timeout)(?:=|$)")
CONFIG_OPTION = re.compile(r"^(?:--config|-c)(?:=|$)")
PACKAGE_MANAGERS = {"pnpm", "npm", "yarn", "bun"}


def check_command(text: str) -> list[str]:
    """シェルの文字列から、時間の上限を変えるオプションと、設定ファイルの差し替えを見つける。"""
    lines = [line for line in text.replace("\\\n", " ").splitlines() if not line.lstrip().startswith("#")]
    problems = []
    for command in SHELL_SPLIT.split("\n".join(lines)):
        tokens = [token.strip("'\"") for token in command.split()]
        for token in tokens:
            if TIMEOUT_OPTION.match(token):
                problems.append(f"時間の上限のオプション {token} がある: {command.strip()}")
        runs_vitest = "vitest" in command or (
            any(token in PACKAGE_MANAGERS for token in tokens) and any(token == "test" or token.startswith("test:") for token in tokens)
        )
        if runs_vitest:
            for token in tokens:
                if CONFIG_OPTION.match(token):
                    problems.append(f"vitest の設定ファイルを差し替えるオプション {token} がある: {command.strip()}")
    return problems


def check_package_scripts(text: str) -> list[str]:
    scripts = json.loads(text).get("scripts", {})
    return [f"scripts.{name}: {problem}" for name, script in scripts.items() for problem in check_command(script)]


# --- 設定 -----------------------------------------------------------------------

TIMEOUT_KEYS = ("testTimeout", "hookTimeout")


def check_vitest_config(text: str) -> list[str]:
    """testTimeout と hookTimeout が、0 より大きく 5000 以下の数値のリテラルで書かれている。"""
    tokens = tokenize(text)
    problems = []
    for key in TIMEOUT_KEYS:
        found = False
        for i, token in enumerate(tokens):
            if token.kind not in ("id", "str") or token.value != key:
                continue
            if i + 1 >= len(tokens) or not is_punct(tokens[i + 1], ":"):
                continue
            found = True
            value, depth = [], 0
            for follow in tokens[i + 2 :]:
                if is_punct(follow, *OPEN):
                    depth += 1
                elif is_punct(follow, *CLOSE):
                    if depth == 0:
                        break
                    depth -= 1
                elif is_punct(follow, ",") and depth == 0:
                    break
                value.append(follow)
            if len(value) != 1 or value[0].kind != "num" or not re.fullmatch(r"\d[\d_]*(\.[\d_]+)?([eE]\d+)?", value[0].value):
                problems.append(f"{token.line}行目: {key} が数値のリテラルでない")
            elif not 0 < float(value[0].value.replace("_", "")) <= MAX_TIMEOUT_MS:
                problems.append(f"{token.line}行目: {key} が 0 より大きく {MAX_TIMEOUT_MS} 以下でない（{value[0].value}）")
        if not found:
            problems.append(f"{key} が無い")
    return problems


CONFIG_NAME = re.compile(r"^vitest\.(config|workspace|projects)\.")


def check_config_files(root: Path) -> list[str]:
    """設定ファイルを置いてよい場所だけに置かれている。vitest.config.* が web にあると vite.config.ts を黙って上書きする。"""
    allowed = {root / "packages" / "core" / "vitest.config.ts"}
    problems = []
    for directory in (root, root / "apps" / "web", root / "packages" / "core"):
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir()):
            if CONFIG_NAME.match(path.name) and path not in allowed:
                problems.append(f"想定外の vitest の設定ファイル: {path.relative_to(root).as_posix()}")
    return problems


# --- 実際のリポジトリ -----------------------------------------------------------


def source_files() -> list[Path]:
    return sorted(path for directory in SOURCE_DIRS for path in directory.rglob("*") if path.suffix in (".ts", ".tsx"))


class RealRepositoryTest(unittest.TestCase):
    def test_検査の対象が見つかっている(self):
        # パスの書き損じで 0 件のまま通らないように
        self.assertGreater(len([p for p in source_files() if p.name.endswith((".test.ts", ".test.tsx"))]), 10)
        self.assertTrue(any(p.name == "test-setup.ts" for p in source_files()))
        self.assertEqual([p for p in PACKAGE_JSONS + CONFIG_FILES if not p.is_file()], [])
        self.assertGreater(len(list(WORKFLOWS_DIR.glob("*.yml"))), 0)

    def test_テストに個別の延長や上限の緩和が無い(self):
        problems = [f"{path.relative_to(ROOT).as_posix()}:{p}" for path in source_files() for p in check_test_source(path.read_text(encoding="utf-8"))]
        self.assertEqual(problems, [])

    def test_package_jsonのscriptsに時間の上限を変えるオプションが無い(self):
        problems = [f"{path.relative_to(ROOT).as_posix()}: {p}" for path in PACKAGE_JSONS for p in check_package_scripts(path.read_text(encoding="utf-8"))]
        self.assertEqual(problems, [])

    def test_ワークフローのrunに時間の上限を変えるオプションが無い(self):
        problems = [
            f"{path.name}: {p}"
            for path in sorted(WORKFLOWS_DIR.glob("*.yml"))
            for block in run_blocks(path.read_text(encoding="utf-8"))
            for p in check_command(block)
        ]
        self.assertEqual(problems, [])

    def test_設定ファイルのtestTimeoutとhookTimeoutが5000以下で明示されている(self):
        problems = [f"{path.relative_to(ROOT).as_posix()}: {p}" for path in CONFIG_FILES for p in check_vitest_config(path.read_text(encoding="utf-8"))]
        self.assertEqual(problems, [])

    def test_想定外のvitestの設定ファイルが無い(self):
        self.assertEqual(check_config_files(ROOT), [])


# --- 検査自身のテスト -----------------------------------------------------------


class DetectSourceTest(unittest.TestCase):
    def assert_detected(self, source: str):
        self.assertNotEqual(check_test_source(source), [], source)

    def test_itとtestの第3引数は数値でも識別子でも式でも検出する(self):
        for third in ["1000", "60_000", "LIMIT", "10 * 1000", "limit()"]:
            for root in ["it", "test"]:
                with self.subTest(root=root, third=third):
                    self.assert_detected(f'{root}("名前", () => {{ run(); }}, {third});')

    def test_timeoutのオプションは検出する(self):
        for source in [
            'it("名前", { timeout: 1000 }, () => {});',
            'it("名前", { timeout }, () => {});',
            'it("名前", { "timeout": LIMIT, retry: 1 }, () => {});',
            'it("名前", { retry: 1, timeout: 1 }, () => {});',
        ]:
            with self.subTest(source=source):
                self.assert_detected(source)

    def test_describeとsuiteの第3引数も検出する(self):
        self.assert_detected('describe("まとまり", () => {}, 1000);')
        self.assert_detected('suite("まとまり", () => {}, 1000);')
        self.assert_detected('describe("まとまり", { timeout: 1000 }, () => {});')

    def test_修飾がついていても検出する(self):
        for modifier in ["skip", "only", "concurrent", "sequential", "todo", "fails"]:
            with self.subTest(modifier=modifier):
                self.assert_detected(f'it.{modifier}("名前", () => {{}}, 1000);')
                self.assert_detected(f'describe.{modifier}("名前", () => {{}}, 1000);')
        self.assert_detected('it.concurrent.skip("名前", () => {}, 1000);')

    def test_eachとskipIfの2段の呼び出しは最後の呼び出しの第3引数を検出する(self):
        for source in [
            'it.each(表)("名前", (a) => {}, 1000);',
            'it.each<[string, number]>(表)(名前, 関数, 1000);',
            'describe.each<Foo<Bar, Baz>>(表)("名前", () => {}, 1000);',
            'it.each([[1, 2]])("名前", (a, b) => {}, 1000);',
            'it.skipIf(条件)("名前", () => {}, 1000);',
            'it.runIf(process.env.CI)("名前", () => {}, 1000);',
            'it.skip.each(表)("名前", () => {}, 1000);',
            'it.each(表)("名前", { timeout: 1000 }, () => {});',
            'it.each`a | b\n${1} | ${2}`("名前", () => {}, 1000);',
            'describe.each`a\n${1}`("名前", () => {}, 1000);',
        ]:
            with self.subTest(source=source):
                self.assert_detected(source)

    def test_フックの第2引数を検出する(self):
        for hook in ["beforeEach", "beforeAll", "afterEach", "afterAll", "onTestFinished", "onTestFailed"]:
            with self.subTest(hook=hook):
                self.assert_detected(f"{hook}(() => {{ setup(); }}, 1000);")
                self.assert_detected(f"{hook}(async () => {{}}, LIMIT);")

    def test_viのsetConfigの呼び出しを検出する(self):
        self.assert_detected("vi.setConfig({ testTimeout: 10_000 });")
        self.assert_detected("vitest.setConfig({ hookTimeout: 10_000 });")

    def test_複数行にわたる呼び出しの最後の引数を検出する(self):
        source = """\
it("名前", () => {
  for (let i = 0; i < 60; i++) add();
  expect(a, "b").toBe(1);
}, 30_000); // 5 秒では足りない
"""
        self.assertEqual(len(check_test_source(source)), 1)
        self.assertIn("1行目", check_test_source(source)[0])

    def test_入れ子のdescribeの中のitの延長を検出する(self):
        self.assert_detected('describe("外", () => { describe("中", () => { it("名前", () => {}, 1000); }); });')

    def test_引数の中の文字列の引用符やカンマに惑わされない(self):
        self.assert_detected("""it("名前, 'x', (", () => { expect(re.test("a,b")).toBe(true); }, 1000);""")


class NoFalsePositiveSourceTest(unittest.TestCase):
    def assert_clean(self, source: str):
        self.assertEqual(check_test_source(source), [], source)

    def test_文字列の中の同じ書き方は検出しない(self):
        self.assert_clean('const a = "it(\\"x\\", () => {}, 1000)"; const b = \'vi.setConfig({})\';')

    def test_テンプレート文字列の中の同じ書き方は検出しない(self):
        self.assert_clean("const a = `it('x', () => {}, 1000) ${ foo(1, 2) } vi.setConfig({})`;")
        self.assert_clean("const a = `${ `it('x', () => {}, 1000)` } beforeEach(f, 1)`; it('名前', () => {});")

    def test_コメントの中の同じ書き方は検出しない(self):
        self.assert_clean('// it("x", () => {}, 1000)\n/* beforeEach(f, 1000);\n vi.setConfig({}) */\nit("名前", () => {});')

    def test_引用符や括弧を含む正規表現リテラルの中は検出しない(self):
        self.assert_clean("""const re = /it\\(["'], [^)]*, 1000\\)/;\nit("名前", () => { expect(re.test("x")).toBe(true); });""")
        self.assert_clean("""const re = /["'(\\/]/g;\nit("名前", () => {});""")
        self.assert_clean("""const re = /[/"']+/;\nit("名前", () => {});""")

    def test_第2引数までの呼び出しは検出しない(self):
        for source in [
            'it("名前", () => {});',
            'test("名前", async () => { await run(); });',
            'it.skip("名前", () => {});',
            'it.each(表)("名前", (a, b) => {});',
            'it.each`a | b\n${1} | ${2}`("名前", () => {});',
            'it.each<[string, number]>(表)("名前", (a, b) => {});',
            'it.skipIf(条件)("名前", () => {});',
            'describe.each(["C", "F"])("%s", (s) => { it("x", () => {}); });',
            'describe("まとまり", () => {});',
        ]:
            with self.subTest(source=source):
                self.assert_clean(source)

    def test_引数の中の配列やオブジェクトや関数呼び出しのカンマは数えない(self):
        self.assert_clean('it("名前", () => { fc.assert(fc.property(a, b, (x, y) => true), { numRuns: 30 }); expect([1, 2, 3]).toEqual({ a: 1, b: 2 }); });')
        self.assert_clean('it.each([[1, 2], [3, 4]])("名前", (a, b) => { expect(f(a, b)).toBe(1); });')
        self.assert_clean('it("名前", () => { const m = new Map<string, number>(); expect(m.get("a")).toBe(undefined); });')

    def test_引数1つのフックは検出しない(self):
        for hook in ["beforeEach", "beforeAll", "afterEach", "afterAll"]:
            with self.subTest(hook=hook):
                self.assert_clean(f"{hook}(() => {{ setup(); }});")
        self.assert_clean("afterEach(cleanup);")

    def test_末尾のカンマは引数に数えない(self):
        self.assert_clean('it("名前", () => {},\n);')
        self.assert_clean("beforeEach(\n  () => {},\n);")

    def test_itやtestの名前を別の意味で使った書き方は検出しない(self):
        self.assert_clean("const total = items.test(1, 2, 3); obj.it('x', f, 1000); const test = 1;")
        self.assert_clean("expect(f(a, b, c)).toBe(1); fc.assert(p, { numRuns: 30 });")

    def test_timeoutという名前の別の使い方は検出しない(self):
        self.assert_clean('it("名前", () => { const options = { timeout: 1000 }; run(options); });')
        self.assert_clean('it("名前", () => { setTimeout(f, 100); });')

    def test_JSXの本文や閉じタグがあっても後ろを巻き込まない(self):
        self.assert_clean("""it("名前", () => { render(<p>it's <b>ok</b></p>); });
it("次", () => {});""")
        problems = check_test_source("""it("名前", () => { render(<p>it's <b>ok</b></p>); });
it("次", () => {}, 1000);""")
        self.assertEqual(len(problems), 1)
        self.assertIn("2行目", problems[0])


class CommandTest(unittest.TestCase):
    def test_時間の上限のオプションはどこに出ても検出する(self):
        for option in ["--testTimeout=10000", "--testTimeout 10000", "--hookTimeout=1", "--test-timeout=10000", "--hook-timeout 1", '"--testTimeout=1"']:
            for command in [f"vitest run {option}", f"pnpm exec vitest run {option}", f"pnpm test -- {option}", f"echo {option}", f"tsc && foo {option}"]:
                with self.subTest(command=command):
                    self.assertNotEqual(check_command(command), [])

    def test_configは_vitestの行とtestスクリプトを呼ぶ行だけ検出する(self):
        for command in [
            "vitest run --config other.ts",
            "vitest run -c other.ts",
            "vitest run --config=other.ts",
            "pnpm exec vitest -c other.ts",
            "pnpm test --config other.ts",
            "pnpm -r test -c other.ts",
            "pnpm --filter web run test --config other.ts",
            "npm test -- -c other.ts",
        ]:
            with self.subTest(command=command):
                self.assertNotEqual(check_command(command), [])

    def test_vitestでない行のconfigとcは検出しない(self):
        for command in [
            "git -c core.quotePath=false diff --name-only",
            "terraform fmt -check -recursive",
            "tsc --noEmit -p tsconfig.test.json",
            "tsc --config tsconfig.json",
            "pnpm install --frozen-lockfile",
            "pnpm typecheck",
            "git -c core.quotePath=false diff && pnpm test",
            "python -m unittest discover -s .github/tests",
        ]:
            with self.subTest(command=command):
                self.assertEqual(check_command(command), [])

    def test_複数行のrunは1行ずつ見る_コメント行は見ない(self):
        self.assertNotEqual(check_command("pnpm install\nvitest run \\\n  --testTimeout=9000\n"), [])
        self.assertNotEqual(check_command("git -c core.quotePath=false diff\npnpm test -c x"), [])
        self.assertEqual(check_command("# vitest run --testTimeout=9000\npnpm test"), [])

    def test_package_jsonのscriptsを見る(self):
        self.assertNotEqual(check_package_scripts('{"scripts": {"test": "vitest run --testTimeout=20000"}}'), [])
        self.assertNotEqual(check_package_scripts('{"scripts": {"ci": "pnpm test --hook-timeout 9"}}'), [])
        self.assertEqual(check_package_scripts('{"scripts": {"test": "vitest run", "typecheck": "tsc --noEmit"}, "name": "--testTimeout"}'), [])
        self.assertEqual(check_package_scripts('{"name": "x"}'), [])

    def test_ワークフローのrunを見る(self):
        workflow = "jobs:\n  t:\n    steps:\n      - run: pnpm test\n      - run: |\n          pnpm install\n          pnpm exec vitest run --testTimeout=60000\n"
        problems = [p for block in run_blocks(workflow) for p in check_command(block)]
        self.assertEqual(len(problems), 1)


class ConfigTest(unittest.TestCase):
    GOOD = "export default defineConfig({ test: { testTimeout: 5000, hookTimeout: 5_000 } });"

    def test_5000以下の数値のリテラルは許す(self):
        self.assertEqual(check_vitest_config(self.GOOD), [])
        self.assertEqual(check_vitest_config("test: { testTimeout: 1, hookTimeout: 2000, }"), [])
        self.assertEqual(check_vitest_config('test: { "testTimeout": 5000, \'hookTimeout\': 5000 }'), [])

    def test_キーが無ければ検出する(self):
        self.assertEqual(len(check_vitest_config("test: { testTimeout: 5000 }")), 1)
        self.assertEqual(len(check_vitest_config("test: { hookTimeout: 5000 }")), 1)
        self.assertEqual(len(check_vitest_config("export default defineConfig({});")), 2)

    def test_コメントや文字列の中のキーは数えない(self):
        self.assertNotEqual(check_vitest_config("// testTimeout: 5000\n/* hookTimeout: 5000 */\ntest: {}"), [])
        self.assertNotEqual(check_vitest_config('const a = "testTimeout: 5000, hookTimeout: 5000";'), [])

    def test_数値のリテラルでなければ検出する(self):
        for value in ["LIMIT", "5 * 1000", "Number(process.env.X)", "limit.timeout", "'5000'", "-1", "undefined"]:
            with self.subTest(value=value):
                config = f"test: {{ testTimeout: {value}, hookTimeout: 5000 }}"
                self.assertNotEqual(check_vitest_config(config), [])

    def test_省略形のキーも数値のリテラルでないので検出する(self):
        self.assertNotEqual(check_vitest_config("test: { testTimeout, hookTimeout: 5000 }"), [])

    def test_0以下と5000超は検出する(self):
        for value in ["0", "5001", "10000", "60_000", "5000.5"]:
            with self.subTest(value=value):
                self.assertNotEqual(check_vitest_config(f"test: {{ testTimeout: {value}, hookTimeout: 5000 }}"), [])

    def test_複数あれば全部検査する(self):
        config = """\
test: { projects: [
  { test: { testTimeout: 5000, hookTimeout: 5000 } },
  { test: { testTimeout: 90000, hookTimeout: 5000 } },
] }
"""
        problems = check_vitest_config(config)
        self.assertEqual(len(problems), 1)
        self.assertIn("3行目", problems[0])
        self.assertEqual(check_vitest_config(config.replace("90000", "5000")), [])


class ConfigFilesTest(unittest.TestCase):
    def check_with(self, files: list[str]) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in files:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("", encoding="utf-8")
            return check_config_files(root)

    def test_想定の配置は許す(self):
        self.assertEqual(self.check_with(["apps/web/vite.config.ts", "packages/core/vitest.config.ts"]), [])

    def test_想定外の設定ファイルを検出する(self):
        for name in [
            "vitest.config.ts",
            "vitest.workspace.ts",
            "vitest.projects.ts",
            "apps/web/vitest.config.ts",
            "apps/web/vitest.workspace.json",
            "packages/core/vitest.workspace.ts",
            "packages/core/vitest.projects.js",
            "packages/core/vitest.config.mts",
        ]:
            with self.subTest(name=name):
                self.assertEqual(len(self.check_with(["packages/core/vitest.config.ts", name])), 1)

    def test_関係のないファイルは見ない(self):
        self.assertEqual(self.check_with(["packages/core/vitest.config.ts", "apps/web/vite.config.ts", "work/vitest.config.ts", "apps/web/src/vitest.config.ts"]), [])


if __name__ == "__main__":
    unittest.main()
