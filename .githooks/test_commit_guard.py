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
    describe_commit_paths,
    describe_gitleaks_findings,
    identity_allowed,
    inspect_files,
    inspect_identities,
    inspect_ref_names,
    load_denylist,
    normalize,
    parse_commit,
    parse_denylist,
    matching_rules,
    private_paths,
    scan_text,
    strip_separators,
)

HIRAGANA = "".join(chr(c) for c in [*range(0x3041, 0x3097), 0x309D, 0x309E])


def to_katakana(text: str) -> str:
    return "".join(chr(ord(c) + 0x60) if c in HIRAGANA else c for c in text)


class NormalizeTest(unittest.TestCase):
    def test_全角半角と大文字小文字の違いを吸収する(self):
        self.assertEqual(normalize("ＡＢＣ　Corp"), normalize("abc corp"))

    def test_半角カナを全角カナにそろえる(self):
        self.assertEqual(normalize("ｶｲｼｬ"), "カイシャ")

    def test_2回かけても結果が変わらない(self):
        rng = random.Random(0)
        alphabet = string.ascii_letters + "ＡＢｃｄ０１ｶﾞｲｼｬ　アイウ漢字ﾟﾞひらがなゔゝ"
        for _ in range(500):
            text = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 20)))
            self.assertEqual(normalize(normalize(text)), normalize(text), repr(text))

    def test_ひらがなをカタカナにそろえる(self):
        self.assertEqual(normalize("ひらがな"), "ヒラガナ")
        self.assertEqual(normalize("ぁゔゖゝゞ"), "ァヴヶヽヾ")
        self.assertEqual(normalize("ー漢字"), "ー漢字")

    def test_ひらがなとカタカナを入れ替えても同じになる(self):
        rng = random.Random(3)
        for _ in range(500):
            hira = "".join(rng.choice(HIRAGANA) for _ in range(rng.randint(0, 12)))
            mixed = "".join(to_katakana(c) if rng.random() < 0.5 else c for c in hira)
            self.assertEqual(normalize(mixed), normalize(hira), repr(hira))
            self.assertEqual(normalize(to_katakana(hira)), normalize(hira), repr(hira))


class StripSeparatorsTest(unittest.TestCase):
    def test_空白・句読点・記号・ゼロ幅文字・制御文字・改行を取り除く(self):
        self.assertEqual(strip_separators("a b-c・d|e_f\tg​h\ni　j。k\x00l"), "abcdefghijkl")

    def test_文字・数字・長音記号は残す(self):
        self.assertEqual(strip_separators("ア1ー漢a"), "ア1ー漢a")


class MatchingRulesTest(unittest.TestCase):
    def numbers(self, term, text):
        return matching_rules(text, parse_denylist(term + "\n"))

    def test_区切りを挿入した書き方でも一致する(self):
        for text in ["example corp", "example-corp", "ex・ample|corp", "example​corp", "ｅｘａｍｐｌｅ　ｃｏｒｐ"]:
            with self.subTest(text):
                self.assertEqual(self.numbers("examplecorp", text), [1])

    def test_区切りをランダムに挿入しても一致する(self):
        rng = random.Random(4)
        separators = [" ", "-", "・", "|", "​", "\t", "。", "_", "　", "\n", "⁠"]
        for term in ["examplecorp", "サンプル会社", "abc", "漢字"]:
            for _ in range(200):
                text = "".join(c + "".join(rng.choice(separators) for _ in range(rng.randint(0, 3))) for c in term)
                self.assertEqual(self.numbers(term, text), [1], repr(text))

    def test_ひらがなの語をカタカナの文で拾う(self):
        self.assertEqual(self.numbers("さんぷる語", "これはサンプル語です"), [1])
        self.assertEqual(self.numbers("サンプル語", "これはさんぷる 語です"), [1])

    def test_ASCIIだけの2文字の語は区切りでは一致しない(self):
        self.assertEqual(self.numbers("ab", "xaby"), [1])
        self.assertEqual(self.numbers("ab", "a-b"), [])
        self.assertEqual(self.numbers("ab", "a b"), [])

    def test_ASCIIだけの3文字の語は区切りでも一致する(self):
        self.assertEqual(self.numbers("abc", "a-b-c"), [1])

    def test_ASCII以外を含む2文字の語は区切りでも一致する(self):
        self.assertEqual(self.numbers("漢字", "漢 字"), [1])
        self.assertEqual(self.numbers("ア1", "ア・1"), [1])

    def test_区切りを取り除くと1文字になる語は取り除く照合に使わない(self):
        self.assertEqual(self.numbers("ア・", "アイウ"), [])
        self.assertEqual(self.numbers("ア・", "ア・イ"), [1])
        self.assertEqual(self.numbers("a!", "abc"), [])

    def test_語の長さは区切りを取り除いた後で数え_ASCII判定も取り除いた後の語で行う(self):
        self.assertEqual(self.numbers("a・b", "xa b"), [])
        self.assertEqual(self.numbers("a・b", "a・b"), [1])

    def test_記号だけの語は取り除くと空になるため今までの照合だけに使う(self):
        self.assertEqual(self.numbers("---", "abc def"), [])
        self.assertEqual(self.numbers("---", "a---b"), [1])


class ScanTextTest(unittest.TestCase):
    def lines(self, term, text):
        return [(h.line, h.rule) for h in scan_text("f", text, parse_denylist(term + "\n"))]

    def test_行をまたぐ一致は先頭の文字がある行を返す(self):
        cases = {
            "foo\nbar": [(1, 1)],
            "ok\nfoo\n\n\nbar\n": [(2, 1)],
            "fo\no\nba\nr": [(1, 1)],
            "x\r\nfoo\r\nbar\r\n": [(2, 1)],
        }
        for text, expected in cases.items():
            with self.subTest(text):
                self.assertEqual(self.lines("foobar", text), expected)

    def test_行の途中から始まる語が次の行に続く場合も先頭の行を返す(self):
        self.assertEqual(self.lines("foobar", "xx fo\nobar yy"), [(1, 1)])

    def test_同じ行・同じルールの一致は1件にまとめる(self):
        self.assertEqual(self.lines("foobar", "foobar foo-bar\n"), [(1, 1)])

    def test_離れた複数の行の一致をそれぞれ返す(self):
        self.assertEqual(self.lines("foobar", "foo\nbar\nzz\nfoobar\nzz\nfoo bar"), [(1, 1), (4, 1), (6, 1)])

    def test_ASCII以外を含む2文字の語は改行をまたいでも止まりASCIIだけの2文字の語は止まらない(self):
        self.assertEqual(self.lines("漢字", "ok\n漢\n字\n"), [(2, 1)])
        self.assertEqual(self.lines("ab", "ok\na\nb\n"), [])

    def test_無関係な文は短い語・記号だけの語があっても止まらない(self):
        rules = parse_denylist("ゐ\nxy\n--\n。。\n")
        self.assertEqual(scan_text("f", "Hello, world.\nこれは無関係な文です。\n", rules), [])


class ParseDenylistTest(unittest.TestCase):
    def test_ひらがなで書いた語もカタカナで書いた語も同じルールになる(self):
        self.assertEqual(parse_denylist("さんぷる語\n"), parse_denylist("サンプル語\n"))

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

    def test_画像とフォントは区切りを取り除く照合をしない(self):
        rules = parse_denylist("abc\n")
        data = b"\x89PNG\x00\xffa-b\x00c-\xff\x81"
        self.assertEqual(inspect_files([("photo.png", data)], rules), [])
        self.assertEqual(inspect_files([("note.txt", b"a-b\nc\n")], rules), [str(Hit("note.txt", 1, 1))])
        self.assertEqual(inspect_files([("photo.png", b"a-b\nc\n")], rules), [])
        self.assertEqual(len(inspect_files([("photo.png", b"\x89PNG\x00abc\x00\x81")], rules)), 1)

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
            split = rng.randint(1, len(term) - 1)
            files = [
                (noise() + term + noise() + ".md", (noise() + term.upper() + noise() + "\n").encode("utf-8")),
                (noise() + ".txt", (noise() + term + "\n").encode("utf-16")),
                (noise() + term[:split] + "-" + term[split:] + ".md", (term[:split] + "\n" + term[split:] + "\n").encode("utf-8")),
                (noise() + ".txt", (" ".join(term) + "\n").encode("utf-8")),
            ]
            for problem in inspect_files(files, rules):
                self.assertNotIn(term, strip_separators(normalize(problem)))

    def test_区切りを入れたパス名もパスを伏せる(self):
        problems = inspect_files([("ok.md", b"ok\n"), ("docs/Example-Corp.md", b"ok\n")], self.rules)
        self.assertEqual(len(problems), 1)
        self.assertIn("2 番目", problems[0])

    def test_ひらがなの語がカタカナのファイル内容に一致する(self):
        hira_rules = parse_denylist("さんぷる語\n")
        self.assertEqual(inspect_files([("a.md", "ok\nサンプル語\n".encode("utf-8"))], hira_rules), [str(Hit("a.md", 2, 1))])
        self.assertEqual(inspect_files([("a.md", "ok\nさんぷる語\n".encode("utf-8"))], self.rules), [str(Hit("a.md", 2, 2))])


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

    def test_区切りを入れたパス名もパスを伏せる(self):
        findings = [{"RuleID": "github-pat", "File": "docs/Example-Corp.md", "StartLine": 1}]
        self.assertIn("パス名を伏せた", describe_gitleaks_findings(findings, self.rules)[0])

    def test_禁止語リストが読めなければすべてのパスを伏せる(self):
        self.assertNotIn("docs/a.md", describe_gitleaks_findings(self.findings, None)[0])


def random_user() -> str:
    return "u" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))


class IdentityAllowedTest(unittest.TestCase):
    def test_noreplyのメールのユーザー名と名前が同じなら許す(self):
        user = random_user()
        self.assertTrue(identity_allowed(user, f"{user}@users.noreply.github.com"))

    def test_メールの先頭に数字とプラスが付く形も許す(self):
        user = random_user()
        self.assertTrue(identity_allowed(user, f"12345+{user}@users.noreply.github.com"))

    def test_大文字小文字は区別しない(self):
        user = random_user()
        self.assertTrue(identity_allowed(user.upper(), f"{user}@Users.NoReply.GitHub.com"))

    def test_名前がユーザー名と違えば許さない(self):
        user = random_user()
        self.assertFalse(identity_allowed(random_user(), f"{user}@users.noreply.github.com"))

    def test_noreply以外のメールは許さない(self):
        user = random_user()
        for email in [
            f"{user}@example.org",
            f"{user}@users.noreply.github.com.example.org",
            f"{user}@noreply.github.com",
            f"{user}@users.noreply.github.com\n",
            f"x+{user}@users.noreply.github.com",
            f"{user}@@users.noreply.github.com",
            "@users.noreply.github.com",
            "",
        ]:
            with self.subTest(email=email):
                self.assertFalse(identity_allowed(user, email))

    def test_名前が空なら許さない(self):
        self.assertFalse(identity_allowed("", "@users.noreply.github.com"))

    def test_GitHubの組はコミッターだけ許す(self):
        self.assertTrue(identity_allowed("GitHub", "noreply@github.com", committer=True))
        self.assertFalse(identity_allowed("GitHub", "noreply@github.com"))

    def test_GitHubの組に似た別の組は許さない(self):
        for name, email in [
            ("GitHub", "other" + "@github.com"),
            ("GitHub", "noreply" + "@github.com.example.org"),
            (random_user(), "noreply@github.com"),
            ("GitHub ", "noreply@github.com"),
        ]:
            with self.subTest(name=name, email=email):
                self.assertFalse(identity_allowed(name, email, committer=True))


class ParseCommitTest(unittest.TestCase):
    raw = (
        b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"
        b"parent 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"
        b"author Some One <one@example.org> 1700000000 +0900\n"
        b"committer GitHub <noreply@github.com> 1700000001 +0000\n"
        b"gpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n"
        b"\n"
        b"docs: subject\n\nbody\n\ntrailer: value\n"
    )

    def test_作者とコミッターとメッセージに分ける(self):
        commit = parse_commit(self.raw)
        self.assertEqual(commit.author, ("Some One", "one@example.org"))
        self.assertEqual(commit.committer, ("GitHub", "noreply@github.com"))
        self.assertEqual(commit.message, b"docs: subject\n\nbody\n\ntrailer: value\n")

    def test_メッセージが空でも読める(self):
        commit = parse_commit(self.raw.split(b"\n\n")[0] + b"\n\n")
        self.assertEqual(commit.message, b"")


class InspectIdentitiesTest(unittest.TestCase):
    @staticmethod
    def commit(author: str, committer: str):
        return parse_commit(f"author {author} 1 +0000\ncommitter {committer} 1 +0000\n\nmsg\n".encode())

    def test_問題のある側だけを短縮ハッシュ付きで示し名前とメールは出さない(self):
        user = random_user()
        commit = self.commit(f"{user} <{user}@users.noreply.github.com>", "Real Name <real@example.org>")
        lines = inspect_identities("abcd1234", commit)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("abcd1234 コミッター"))
        for shown in ["Real Name", "real@example.org", "real"]:
            self.assertNotIn(shown, lines[0])

    def test_GitHubの組のコミッターは問題にしない(self):
        user = random_user()
        commit = self.commit(f"{user} <{user}@users.noreply.github.com>", "GitHub <noreply@github.com>")
        self.assertEqual(inspect_identities("abcd1234", commit), [])

    def test_禁止語と同じユーザー名でも照合しない(self):
        # 禁止語の照合は、ここでは呼ばない（公開してよいユーザー名が入るため）
        who = "zqsecret <zqsecret@users.noreply.github.com>"
        self.assertEqual(inspect_identities("abcd1234", self.commit(who, who)), [])


class DescribeCommitPathsTest(unittest.TestCase):
    rules = parse_denylist("examplecorp\n")

    def test_禁止語に一致しないパス名は問題にしない(self):
        self.assertEqual(describe_commit_paths("abcd1234", ["docs/a.md", "b.txt"], self.rules), [])

    def test_一致したパス名は伏せて何番目かだけを示す(self):
        lines = describe_commit_paths("abcd1234", ["docs/a.md", "docs/ExampleCorp.md"], self.rules)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("abcd1234 の 2 番目のファイル"))
        self.assertTrue(lines[0].endswith("のパス名: 禁止語ルール 1"))
        self.assertNotIn("xamplecorp", normalize(lines[0]))

    def test_区切りを入れたパス名も伏せる(self):
        lines = describe_commit_paths("abcd1234", ["docs/Example-Corp.md"], self.rules)
        self.assertEqual(len(lines), 1)
        self.assertNotIn("Example", lines[0])


class InspectRefNamesTest(unittest.TestCase):
    rules = parse_denylist("examplecorp\n")

    def test_一致したrefは名前を出さずブランチかタグかだけを示す(self):
        lines = inspect_ref_names(["refs/heads/main", "refs/tags/v-ExampleCorp", "refs/heads/ExampleCorp"], self.rules)
        self.assertEqual(len(lines), 2)
        self.assertIn("送るタグ", lines[0])
        self.assertIn("送るブランチ", lines[1])
        self.assertIn("禁止語ルール 1", lines[0])
        self.assertNotIn("xamplecorp", normalize("".join(lines)))

    def test_一致しなければ何も返さない(self):
        self.assertEqual(inspect_ref_names(["refs/heads/main"], self.rules), [])


if __name__ == "__main__":
    unittest.main()
