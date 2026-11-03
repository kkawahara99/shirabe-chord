import random
import string
import tempfile
import unittest
from pathlib import Path

from commit_guard import (
    DenylistUnavailable,
    Hit,
    Undecodable,
    decode,
    describe_gitleaks_findings,
    inspect_files,
    load_denylist,
    normalize,
    parse_denylist,
    private_paths,
    scan_text,
)


class NormalizeTest(unittest.TestCase):
    def test_全角半角と大文字小文字の違いを吸収する(self):
        self.assertEqual(normalize("ＡＢＣ　Corp"), normalize("abc corp"))

    def test_半角カナを全角カナにそろえる(self):
        self.assertEqual(normalize("ｶｲｼｬ"), "カイシャ")

    def test_2回かけても結果が変わらない(self):
        rng = random.Random(0)
        alphabet = string.ascii_letters + "ＡＢｃｄ０１ｶﾞｲｼｬ　アイウ漢字ﾟﾞ"
        for _ in range(500):
            text = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 20)))
            self.assertEqual(normalize(normalize(text)), normalize(text), repr(text))


class ParseDenylistTest(unittest.TestCase):
    def test_空行とコメント行を無視し元の行番号をルール番号にする(self):
        rules = parse_denylist("# コメント\n\nサンプル語\n  ExampleCorp  \n")
        self.assertEqual([(r.number, r.term) for r in rules], [(3, "サンプル語"), (4, "examplecorp")])


class LoadDenylistTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name, "denylist.txt")

    def tearDown(self):
        self.dir.cleanup()

    def test_ファイルが無ければ検査できないとして例外にする(self):
        with self.assertRaises(DenylistUnavailable):
            load_denylist(self.path)

    def test_語が1つも無ければ例外にする(self):
        self.path.write_text("# まだ空\n\n", encoding="utf-8")
        with self.assertRaises(DenylistUnavailable):
            load_denylist(self.path)

    def test_BOM付きのファイルでも先頭の語を読める(self):
        self.path.write_text("サンプル語\n", encoding="utf-8-sig")
        self.assertEqual(load_denylist(self.path)[0].term, "サンプル語")

    def test_UTF8以外で保存されていれば保存し直すよう案内する(self):
        self.path.write_bytes("サンプル語\n".encode("cp932"))
        with self.assertRaisesRegex(DenylistUnavailable, "UTF-8 で保存"):
            load_denylist(self.path)


class DecodeTest(unittest.TestCase):
    text = "日本語と ascii"

    def test_UTF8とUTF16とShiftJISを読める(self):
        for encoding in ["utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "cp932"]:
            with self.subTest(encoding):
                self.assertEqual(decode(self.text.encode(encoding)), self.text)

    def test_どの文字コードでも読めなければ例外にする(self):
        with self.assertRaises(Undecodable):
            decode(b"\x81\xff\xfe\x80\xa0")

    def test_NULを含む小さなバイナリをUTF16の文字と取り違えない(self):
        rng = random.Random(2)
        accepted = 0
        for _ in range(500):
            data = bytes(rng.choice([0, rng.randrange(256)]) for _ in range(64))
            try:
                decode(data)
                accepted += 1
            except Undecodable:
                pass
        self.assertEqual(accepted, 0)


class InspectFilesTest(unittest.TestCase):
    rules = parse_denylist("examplecorp\nサンプル語\n")

    def test_一致した行の行番号とルール番号を返す(self):
        content = "ok\nこれは ＥｘａｍｐｌｅＣｏｒｐ の話\nｻﾝﾌﾟﾙ語\n".encode("utf-8")
        self.assertEqual(inspect_files([("a.md", content)], self.rules), [str(Hit("a.md", 2, 1)), str(Hit("a.md", 3, 2))])

    def test_一致が無ければ空を返す(self):
        self.assertEqual(inspect_files([("a.md", "無関係な文\n".encode("utf-8"))], self.rules), [])

    def test_パス名が一致したファイルはパスを伏せて何番目かで示す(self):
        files = [("ok.md", b"ok\n"), ("docs/ExampleCorp.md", "サンプル語\n".encode("utf-8"))]
        problems = inspect_files(files, self.rules)
        self.assertEqual(len(problems), 2)
        self.assertTrue(all("2 番目" in p for p in problems), problems)

    def test_UTF16やShiftJISで書かれた禁止語も拾う(self):
        for encoding in ["utf-16", "utf-16-le", "cp932"]:
            with self.subTest(encoding):
                self.assertEqual(len(inspect_files([("a.txt", "サンプル語\n".encode(encoding))], self.rules)), 1)

    def test_文字コードを判別できないファイルは検査できないとして止める(self):
        problems = inspect_files([("blob.bin", b"\x81\xff\xfe\x80\xa0")], self.rules)
        self.assertEqual(len(problems), 1)
        self.assertIn("検査できません", problems[0])

    def test_画像は文字コードを判別できなくても止めない(self):
        self.assertEqual(inspect_files([("icon.PNG", b"\x81\xff\xfe\x80\xa0")], self.rules), [])

    def test_画像のバイト列に埋め込まれた禁止語は拾う(self):
        data = b"\x89PNG\x00\xff" + "Author: サンプル語".encode("utf-8") + b"\x00\x81"
        self.assertEqual(len(inspect_files([("photo.png", data)], self.rules)), 1)

    def test_PDFや書庫は文字として読めなければ止める(self):
        for name in ["resume.pdf", "a.zip", "b.docx"]:
            with self.subTest(name):
                problems = inspect_files([(name, b"%PDF-1.7\n\x81\xff\xfe\x80\xa0")], self.rules)
                self.assertTrue(problems and "検査できません" in problems[0], problems)

    def test_サブモジュールはパス名だけを照合する(self):
        self.assertEqual(len(inspect_files([("vendor/ExampleCorp", None)], self.rules)), 1)
        self.assertEqual(inspect_files([("vendor/lib", None)], self.rules), [])

    def test_出力に一致した語を含めない(self):
        rng = random.Random(1)
        letters = string.ascii_lowercase
        for _ in range(200):
            term = "".join(rng.choice(letters) for _ in range(rng.randint(3, 8)))
            rules = parse_denylist(term + "\n")
            noise = lambda: "".join(rng.choice(letters + " /._") for _ in range(rng.randint(0, 10)))  # noqa: E731
            files = [
                (noise() + term + noise() + ".md", (noise() + term.upper() + noise() + "\n").encode("utf-8")),
                (noise() + ".txt", (noise() + term + "\n").encode("utf-16")),
            ]
            for problem in inspect_files(files, rules):
                self.assertNotIn(term, normalize(problem))


class PrivatePathsTest(unittest.TestCase):
    def test_どの階層のprivateディレクトリも対象にする(self):
        paths = ["private/raw.md", "data/private/x.txt", "Private/y.txt", "docs/private.md", "privately/z.md"]
        self.assertEqual(private_paths(paths), ["private/raw.md", "data/private/x.txt", "Private/y.txt"])


class DescribeGitleaksFindingsTest(unittest.TestCase):
    rules = parse_denylist("examplecorp\n")
    findings = [
        {"RuleID": "email-address", "File": "docs/a.md", "StartLine": 3, "Match": "秘密", "Secret": "秘密"},
        {"RuleID": "github-pat", "File": "docs/ExampleCorp.md", "StartLine": 1},
        {"RuleID": "github-pat", "File": "", "StartLine": 2},
    ]

    def test_ルールIDと場所と行番号だけを出し一致した文字列は出さない(self):
        lines = describe_gitleaks_findings(self.findings, self.rules)
        self.assertEqual(lines[0], "docs/a.md:3: gitleaks ルール email-address")
        self.assertNotIn("秘密", "\n".join(lines))

    def test_パス名が禁止語に一致すればパスを伏せる(self):
        self.assertNotIn("examplecorp", normalize(describe_gitleaks_findings(self.findings, self.rules)[1]))

    def test_ファイル名の無い検出はコミットメッセージとして示す(self):
        self.assertTrue(describe_gitleaks_findings(self.findings, self.rules)[2].startswith("コミットメッセージ:2:"))

    def test_禁止語リストが読めなければすべてのパスを伏せる(self):
        self.assertNotIn("docs/a.md", describe_gitleaks_findings(self.findings, None)[0])


if __name__ == "__main__":
    unittest.main()
