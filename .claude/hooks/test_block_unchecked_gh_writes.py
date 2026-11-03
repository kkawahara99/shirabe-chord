"""gh で公開する文章を送る前に検査するフックのテスト。

禁止語・偽トークンはテストの実行中に組み立てる（このファイル自体が検査に掛からないように）。
本物の commit-msg を通すのは禁止語・gitleaks に関わる項目だけ（1 回約 2 秒）。それ以外は、
呼ばれた回数と受け取った中身を記録する差し替えを使う。
"""

import json
import os
import secrets
import string
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from block_unchecked_gh_writes import check_command

HOOKS_DIR = Path(__file__).resolve().parent
HOOK = HOOKS_DIR / "block-unchecked-gh-writes.sh"
SETTINGS = HOOKS_DIR.parent / "settings.json"

OUT_OF_SCOPE = "検査の対象外です。本人が実行してください"
GUIDE_FILE = "`work/` のファイルに書き"
GUIDE_BODY_FILE = "`--body-file <ファイル>`"
GUIDE_ONE_BY_ONE = "1 本ずつ分けてください"


def forbidden_term() -> str:
    return "zq" + secrets.token_hex(4)


def fake_github_token() -> str:
    alphabet = string.ascii_letters + string.digits
    return "ghp" + "_" + "".join(secrets.choice(alphabet) for _ in range(36))


class StubTestCase(unittest.TestCase):
    """commit-msg の代わりに、呼ばれた回数と受け取った中身を記録する差し替えを使うテストの土台。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.cwd = self.tmp / "cwd"
        (self.cwd / "work").mkdir(parents=True)
        (self.cwd / "work" / "ok.md").write_text("BODYLINE-ok\n", encoding="utf-8")
        self.calls = self.tmp / "calls"
        self.calls.mkdir()
        self.stub = self.make_stub(f'cp "$1" "{self.calls.as_posix()}/call-$$"\nexit 0\n')

    def make_stub(self, body: str) -> Path:
        path = self.tmp / f"stub{len(list(self.tmp.glob('stub*')))}.sh"
        path.write_text("#!/bin/sh\n" + body, encoding="utf-8", newline="\n")
        return path

    def check(self, command: str, tool: str = "Bash", stub: Path = None, cwd: Path = None):
        return check_command(command, str(cwd or self.cwd), tool, commit_msg=stub or self.stub)

    def captured(self) -> list[str]:
        return [p.read_text(encoding="utf-8") for p in sorted(self.calls.iterdir())]

    def write(self, name: str, text: str) -> None:
        (self.cwd / "work" / name).write_text(text, encoding="utf-8", newline="\n")


class PassThroughTest(StubTestCase):
    def test_読み取りのghは通す(self):
        for command in [
            "gh issue view 4",
            "gh issue list --state open",
            "gh pr view 3 --comments",
            "gh pr list",
            "gh pr status",
            "gh pr diff 3",
            "gh pr checks 3",
            "gh run watch 123",
            "gh run download 123",
            "gh pr checkout 3",
            "gh search issues foo",
            "gh --version",
            "gh issue create --help",
            "gh label list",
            "gh repo view",
            "gh api repos/:owner/:repo/issues",
            "gh api repos/o/r/milestones --jq .[].title",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))
        self.assertEqual(self.captured(), [])

    def test_helpの語を値に紛れ込ませても検査を逃れない(self):
        self.assertIsNotNone(self.check("gh issue create --title --help --body-file work/missing.md"))

    def test_ghでないコマンドやghの語を含むだけのコマンドは通す(self):
        for command in ["git status", "echo hello", 'git commit -m "fix: gh issue create"', 'rg "gh issue create" docs', "cat gh.md", "rg gh docs", "git log --grep gh"]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))
        self.assertEqual(self.captured(), [])

    def test_ghのexeや絶対パスや前置き付きでも同じに扱う(self):
        for command in [
            "gh.exe issue comment 5 --body-file work/ok.md",
            "/usr/bin/gh issue comment 5 --body-file work/ok.md",
            '"C:/Program Files/GitHub CLI/gh.exe" issue comment 5 --body-file work/ok.md',
            "sudo gh issue comment 5 --body-file work/ok.md",
            "env FOO=1 gh issue comment 5 --body-file work/ok.md",
            "GH_DEBUG=1 gh issue comment 5 --body-file work/ok.md",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))
        self.assertEqual(len(self.captured()), 6)
        self.assertTrue(all("BODYLINE-ok" in text for text in self.captured()))

    def test_PowerShellではバックスラッシュをパス区切りに直してから分解する(self):
        self.assertIsNone(self.check("gh issue comment 5 --body-file work\\ok.md", tool="PowerShell"))
        self.assertIn("BODYLINE-ok", self.captured()[0])


class OutOfScopeTest(StubTestCase):
    def test_対象外のghの操作は案内を出して止める(self):
        for command in [
            "gh release create v1",
            "gh gist create f.txt",
            "gh secret set X",
            "gh variable set X",
            "gh repo create foo",
            "gh issue delete 3",
            "gh label delete bug",
            "gh pr ready 3",
            "gh workflow run x.yml",
            "gh auth login",
            "gh",
            "gh frobnicate",
        ]:
            with self.subTest(command=command):
                self.assertIn(OUT_OF_SCOPE, self.check(command) or "")
        self.assertEqual(self.captured(), [])


class ApiMethodTest(StubTestCase):
    METHODS = ["POST", "DELETE", "PATCH", "PUT", "post"]

    @staticmethod
    def spellings(method):
        return [["-X", method], [f"-X{method}"], ["--method", method], [f"--method={method}"]]

    def test_gh_apiはGET以外なら書き方とフィールドの有無を問わず検査する(self):
        failing = self.make_stub('echo "コミットメッセージ:1: 禁止語ルール 1" >&2\nexit 1\n')
        for method in self.METHODS:
            for spelling in self.spellings(method):
                with self.subTest(method=method, spelling=spelling, fields=True):
                    command = " ".join(["gh api repos/o/r/issues", *spelling, "-f title=t"])
                    self.assertIsNotNone(self.check(command, stub=failing))
                with self.subTest(method=method, spelling=spelling, fields=False):
                    # フィールドが無ければ検査する文字列が無いので、commit-msg は呼ばずに通す
                    command = " ".join(["gh api repos/o/r/issues/comments/1", *spelling])
                    self.assertIsNone(self.check(command, stub=failing))

    def test_gh_apiのGETは検査せず通す(self):
        failing = self.make_stub("exit 1\n")
        for command in [
            "gh api repos/o/r/issues",
            "gh api -X GET repos/o/r/issues -f q=x",
            "gh api --method get repos/o/r/issues -f q=x",
            "gh api -XGET repos/o/r/issues -f q=x",
            "gh api --method=GET repos/o/r/issues -F a=b",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command, stub=failing))

    def test_gh_apiはメソッドが無くてもフィールドかinputがあればPOSTとして検査する(self):
        failing = self.make_stub("exit 1\n")
        for command in [
            "gh api repos/o/r/issues -f title=t",
            "gh api repos/o/r/issues -F title=t",
            "gh api repos/o/r/issues --field title=t",
            "gh api repos/o/r/issues --raw-field title=t",
            "gh api repos/o/r/issues -ftitle=t",
            "gh api repos/o/r/issues -Ftitle=t",
            "gh api repos/o/r/issues --field=title=t",
            "gh api repos/o/r/issues --raw-field=title=t",
            "gh api repos/o/r/issues --input work/ok.md",
        ]:
            with self.subTest(command=command):
                self.assertIsNotNone(self.check(command, stub=failing))

    def test_gh_apiのメソッドを決められない形は止める(self):
        for command in ["gh api -X $M repos/o/r -f a=b", 'gh api --method "$(x)" repos/o/r -f a=b']:
            with self.subTest(command=command):
                self.assertIn(GUIDE_FILE, self.check(command) or "")


class CollectionTest(StubTestCase):
    def test_識別子以外の値を種類つき見出しを挟んで1つのファイルにまとめる(self):
        cases = [
            ('gh issue create --title "My title" --body-file work/ok.md --label lbl', ["### --title\nMy title\n", "### --body-file work/ok.md\nBODYLINE-ok\n", "### --label\nlbl\n"]),
            ("gh issue comment 5 --body=value1", ["### --body\nvalue1\n"]),
            ("gh issue comment 5 -bvalue2", ["### -b\nvalue2\n"]),
            ("gh label create newlabel --description desc --color ff0000", ["### 位置引数\nnewlabel\n", "### --description\ndesc\n", "### --color\nff0000\n"]),
            ("gh repo edit own/repo --description d1 --add-topic t1", ["### --description\nd1\n", "### --add-topic\nt1\n"]),
            ("gh api repos/o/r/milestones -f title=t1 -f description=d1", ["### -f\ntitle=t1\n", "### -f\ndescription=d1\n"]),
        ]
        for command, expected in cases:
            with self.subTest(command=command):
                for stale in self.calls.iterdir():
                    stale.unlink()
                self.assertIsNone(self.check(command))
                (text,) = self.captured()
                position = 0
                for piece in expected:
                    found = text.find(piece, position)
                    self.assertNotEqual(found, -1, f"{piece!r} が順に見つからない: {text!r}")
                    position = found + len(piece)

    def test_識別子は集めない(self):
        command = (
            "gh issue create --repo idrepoxx/r -R idrepoyy/r -Ridrepozz/r --repo=idrepoaa/r --hostname idhostxx "
            "--head idheadxx:br --assignee idassignee --add-assignee idaddxx --reviewer idrevxx "
            "https://github.com/idurlxx/r/issues/1 12 --title t1"
        )
        self.assertIsNone(self.check(command))
        api = 'gh api repos/idendxx/r/milestones -X POST -H "Accept: idheaderxx" --hostname idhost2 --jq .idjqxx --cache 1h -f title=t2'
        self.assertIsNone(self.check(api))
        self.assertIsNone(self.check("gh repo edit idrepobb/r --description d3"))
        text = "".join(self.captured())
        for kept in ["t1", "t2", "d3"]:
            self.assertIn(kept, text)
        for identifier in ["idrepo", "idhost", "idhead", "idassignee", "idaddxx", "idrevxx", "idurlxx", "idendxx", "idheaderxx", "idjqxx", "https://"]:
            self.assertNotIn(identifier, text)

    def test_ファイルの中身も相対パスをcwd起点にして集める(self):
        for command in [
            "gh issue create --title t --body-file work/ok.md",
            "gh issue create --title t --body-file=work/ok.md",
            "gh issue create --title t -F work/ok.md",
            "gh issue create --title t -Fwork/ok.md",
            "gh pr create --title t --body-file work/ok.md",
            "gh api repos/o/r/issues --input work/ok.md",
            "gh api repos/o/r/issues -F body=@work/ok.md",
            "gh api repos/o/r/issues --field body=@work/ok.md",
            "gh api repos/o/r/issues --field=body=@work/ok.md",
        ]:
            with self.subTest(command=command):
                for stale in self.calls.iterdir():
                    stale.unlink()
                self.assertIsNone(self.check(command))
                self.assertIn("BODYLINE-ok", "".join(self.captured()))

    def test_検査はcommit_msgを1回だけ呼ぶ(self):
        self.write("second.md", "BODYLINE-second\n")
        command = "gh api repos/o/r/issues -f a=b -f c=d --input work/second.md -F e=@work/ok.md"
        self.assertIsNone(self.check(command))
        (text,) = self.captured()
        for piece in ["a=b", "c=d", "BODYLINE-second", "BODYLINE-ok"]:
            self.assertIn(piece, text)


class ReportTest(StubTestCase):
    def test_指摘の行番号を見出しから逆引きして種類と行で示す(self):
        stub = self.make_stub(
            'grep -n BADMARK "$1" | cut -d: -f1 | while read n; do echo "  コミットメッセージ:$n: 禁止語ルール 7" >&2; done\nexit 1\n'
        )
        self.write("bad.md", "a\nb\nBADMARK\n")
        message = self.check("gh issue create --title BADMARK --body-file work/bad.md", stub=stub)
        self.assertIn("--title の 1 行目", message)
        self.assertIn("--body-file の 3 行目", message)
        self.assertIn("禁止語ルール 7", message)
        self.assertNotIn("BADMARK", message)

    def test_ファイル名に禁止語があっても出力にファイル名を出さない(self):
        stub = self.make_stub(
            'grep -n BADMARK "$1" | cut -d: -f1 | while read n; do echo "  コミットメッセージ:$n: 禁止語ルール 3" >&2; done\nexit 1\n'
        )
        self.write("BADMARK.md", "fine\n")
        message = self.check("gh issue create --title t --body-file work/BADMARK.md", stub=stub)
        self.assertIn("--body-file の見出し", message)
        self.assertNotIn("BADMARK", message)


class UnreadableFormsTest(StubTestCase):
    def assert_guided(self, command, tool="Bash"):
        message = self.check(command, tool=tool)
        self.assertIsNotNone(message, command)
        self.assertIn(GUIDE_FILE, message)
        self.assertEqual(self.captured(), [])

    def test_標準入力は止めて案内する(self):
        for command in [
            "gh issue create --title t --body-file -",
            "gh issue create --title t --body-file=-",
            "gh issue create --title t -F -",
            "gh api repos/o/r/issues -X POST --input -",
            "gh api repos/o/r/issues -F body=@-",
            "cat work/ok.md | gh issue comment 5 --body-file -",
            "gh issue comment 5 --body-file - <<'EOF'\ntext\nEOF",
        ]:
            with self.subTest(command=command):
                self.assert_guided(command)

    def test_変数やコマンド置換やプロセス置換を含む値とパスは止める(self):
        for command in [
            'gh issue create --title "$TITLE" --body-file work/ok.md',
            "gh issue create --title '$X' --body-file work/ok.md",
            'gh issue create --title "$(date)" --body-file work/ok.md',
            "gh issue create --title `date` --body-file work/ok.md",
            "gh issue create --title t --body-file work/$F.md",
            "gh issue create --title t --body-file <(echo hi)",
            "gh issue create --repo $(echo o/r) --title t --body-file work/ok.md",
            "gh issue create --title t --body-file ${X}",
        ]:
            with self.subTest(command=command):
                self.assert_guided(command)

    def test_識別子の中の変数は通す(self):
        self.assertIsNone(self.check('gh issue create --repo "$REPO" --title t --body-file work/ok.md'))

    def test_PowerShellのhere_stringは止める(self):
        for command in ["gh issue comment 5 --body @'\nabc\n'@", 'gh issue comment 5 --body @"\nabc\n"@']:
            with self.subTest(command=command):
                self.assert_guided(command, tool="PowerShell")

    def test_存在しない_ディレクトリ_UTF8でないファイルは止める(self):
        (self.cwd / "work" / "latin.md").write_bytes(b"\xff\xfe\x00bad\xc3\x28")
        for command in [
            "gh issue comment 5 --body-file work/none.md",
            "gh issue comment 5 --body-file work",
            "gh issue comment 5 --body-file work/latin.md",
        ]:
            with self.subTest(command=command):
                self.assert_guided(command)

    def test_解析できないコマンドは止める(self):
        self.assert_guided('gh issue create --title "abc --body-file work/ok.md')
        self.assertIsNone(self.check('echo "abc'))

    def test_検査対象のghの前に別のコマンドがつながった形は止める(self):
        for command in [
            "cd work && gh issue comment 5 --body-file ok.md",
            "echo a || gh issue comment 5 --body-file work/ok.md",
            "echo a; gh issue comment 5 --body-file work/ok.md",
            "echo a | gh issue comment 5 --body-file work/ok.md",
            "echo a & gh issue comment 5 --body-file work/ok.md",
            "echo a\ngh issue comment 5 --body-file work/ok.md",
            'sh -c "cd work && gh issue comment 5 --body-file ok.md"',
            "bash -c 'echo x; gh issue comment 5 --body-file work/ok.md'",
            "gh issue list && gh issue comment 5 --body-file work/ok.md",
        ]:
            with self.subTest(command=command):
                self.assert_guided(command)

    def test_ghの後ろにつながる分とsh_cの中の単独のghと読み取りどうしの連結は通す(self):
        for command in [
            "gh issue comment 5 --body-file work/ok.md && echo done",
            "gh issue comment 5 --body-file work/ok.md | cat",
            'sh -c "gh issue comment 5 --body-file work/ok.md"',
            "gh issue list && gh pr list",
            "git status && gh issue view 3",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))

    def test_止めるときの案内にworkのファイルとbody_fileとコマンドを分けることが入る(self):
        message = self.check("gh issue create --title t --body-file -")
        for phrase in [GUIDE_FILE, GUIDE_BODY_FILE, GUIDE_ONE_BY_ONE]:
            self.assertIn(phrase, message)


class BypassTest(StubTestCase):
    """レビューで見つかった、検査を逃れうる書き方。"""

    def test_ghが行の先頭にない書き方は止める(self):
        for command in [
            "xargs -a work/bad.md gh issue comment 5 --body",
            "cat work/bad.md | xargs -0 -I{} gh issue comment 5 --body {}",
            "{ gh issue comment 5 --body X; }",
            "if true; then gh issue comment 5 --body X; fi",
            "! gh issue comment 5 --body X",
            "for f in a; do gh issue comment 5 --body X; done",
            "find . -exec gh issue comment 5 --body X {} ;",
            "env -u X gh issue comment 5 --body X",
        ]:
            with self.subTest(command=command):
                self.assertIn(GUIDE_FILE, self.check(command) or "")
        for command in ["cmd /c gh issue comment 5 --body X", "Start-Process gh -ArgumentList 'issue comment 5'"]:
            with self.subTest(command=command, tool="PowerShell"):
                self.assertIn(GUIDE_FILE, self.check(command, tool="PowerShell") or "")

    def test_PowerShellの括弧で値を決める書き方は止める(self):
        for command in [
            "gh issue close 5 --comment (Get-Content work/bad.md -Raw)",
            "gh issue close 5 -c (Get-Content work/bad.md -Raw)",
            "gh label create x -d (Get-Content work/bad.md -Raw)",
            "gh repo edit -d (Get-Content work/bad.md -Raw)",
            "gh issue comment 5 --body @(Get-Content work/bad.md)",
            "gh label create (Get-Content work/bad.md -Raw)",
            "gh issue comment 5 --body=(Get-Content work/bad.md -Raw)",
        ]:
            with self.subTest(command=command):
                self.assertIn(GUIDE_FILE, self.check(command, tool="PowerShell") or "")
        self.assertIsNone(self.check("gh issue comment 5 --body 'text (with parentheses)'", tool="PowerShell"))

    def test_起動役に渡す文字列の途中にあるghも読み直して止める(self):
        for command, tool in [
            ('iex "Write-Host x; gh issue comment 5 --body X"', "PowerShell"),
            ('Invoke-Expression -Command "Set-Location work; gh issue comment 5 --body-file bad.md"', "PowerShell"),
            ('cmd /c "echo x & gh issue comment 5 --body X"', "PowerShell"),
        ]:
            with self.subTest(command=command):
                self.assertIn(GUIDE_FILE, self.check(command, tool=tool) or "")

    def test_引数の文字列がそのままghのコマンドになる形は中身を検査する(self):
        self.assertIsNone(self.check("iex 'gh issue comment 5 --body STRINGCMD'", tool="PowerShell"))
        self.assertIn("STRINGCMD", "".join(self.captured()))

    def test_先頭にないghでも読み取りなら通す(self):
        for command in ["if true; then gh issue list; fi", "xargs gh issue view", "echo gh"]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))

    def test_値を取るオプションの値が読み取れないときは止める(self):
        for command in [
            "gh issue comment 5 --body (Get-Content work/bad.md -Raw)",
            "gh issue create --title",
            "gh issue comment 5 -b",
            "gh api repos/o/r/issues -f",
        ]:
            with self.subTest(command=command):
                self.assertIn(GUIDE_FILE, self.check(command, tool="PowerShell") or "")

    def test_値を取るかが曖昧な短いオプションが最後にあっても止めない(self):
        for command in ["gh pr merge 5 -d", "gh pr merge 5 --squash -d", "gh pr review 3 --approve --comment"]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))

    def test_短いオプションの束の中の値も検査する(self):
        cases = {
            "gh pr merge 3 -sbVALUE1": "VALUE1",
            "gh pr review 3 -abVALUE2": "VALUE2",
            "gh pr create -fTVALUE3 --body-file work/ok.md": "VALUE3",
            "gh api repos/o/r/issues -iftitle=VALUE4": "title=VALUE4",
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                for stale in self.calls.iterdir():
                    stale.unlink()
                self.assertIsNone(self.check(command))
                self.assertIn(expected, "".join(self.captured()))

    def test_URLで始まる本文や数字だけの値も検査し_位置引数のURLと数字は検査しない(self):
        self.assertIsNone(self.check('gh issue comment 5 --body "https://x.example/ FREETEXT1 以下自由文"'))
        self.assertIsNone(self.check("gh issue edit 5 --title 0312345678"))
        self.assertIsNone(self.check("gh issue comment https://github.com/idurlxx/r/issues/7 12 --body ok"))
        text = "".join(self.captured())
        self.assertIn("FREETEXT1", text)
        self.assertIn("0312345678", text)
        self.assertNotIn("idurlxx", text)

    def test_recoverのファイルは検査できないので止める(self):
        self.assertIn(GUIDE_FILE, self.check("gh issue create --recover work/ok.md --title t") or "")


class RealInspectionTest(unittest.TestCase):
    """本物の commit-msg を通す（禁止語リストは一時のものを環境変数で渡す）。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.cwd = self.tmp / "cwd"
        (self.cwd / "work").mkdir(parents=True)
        self.term = forbidden_term()
        self.owner = forbidden_term()
        self.denylist = self.tmp / "denylist.txt"
        self.denylist.write_text(f"{self.term}\n{self.owner}\n", encoding="utf-8")
        patcher = mock.patch.dict(os.environ, {"SHIRABE_CHORD_DENYLIST": str(self.denylist)})
        patcher.start()
        self.addCleanup(patcher.stop)
        (self.cwd / "work" / "ok.md").write_text("問題のない本文\n", encoding="utf-8")
        (self.cwd / "work" / "bad.md").write_text(f"1 行目\n本文に {self.term} が入る\n", encoding="utf-8")

    def check(self, command):
        return check_command(command, str(self.cwd), "Bash")

    def test_禁止語を含むと止まり一致した語が出力に出ない(self):
        term = self.term
        for command in [
            "gh issue create --title ok --body-file work/bad.md",
            "gh issue comment 5 --body-file work/bad.md",
            f"gh pr create --title {term} --body-file work/ok.md",
            f"gh issue create --title ok --body={term}",
            f"gh pr create --title t --body={term}",
            f"gh api repos/o/r/milestones -f title={term} -f description=d",
            "gh api -X POST repos/o/r/issues/5/comments --input work/bad.md",
        ]:
            with self.subTest(command=command):
                message = self.check(command)
                self.assertIsNotNone(message)
                self.assertIn("禁止語ルール 1", message)
                self.assertNotIn(term, message)

    def test_検査を通る本文は通り_repoやエンドポイントにユーザー名があっても止まらない(self):
        owner = self.owner
        for command in [
            f"gh issue create --repo {owner}/x --title ok --body-file work/ok.md",
            f"gh api repos/{owner}/x/milestones -f title=ok",
            f"gh issue comment https://github.com/{owner}/x/issues/1 --body ok",
            f"gh issue view https://github.com/{owner}/x/issues/1",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(self.check(command))

    def test_禁止語リストが無いときは止める(self):
        with mock.patch.dict(os.environ, {"SHIRABE_CHORD_DENYLIST": str(self.tmp / "none.txt")}):
            self.assertIsNotNone(self.check("gh issue comment 5 --body-file work/ok.md"))

    def test_gitleaksが無いときは止める(self):
        with mock.patch.dict(os.environ, {"GITLEAKS": str(self.tmp / "no-such-gitleaks")}):
            self.assertIsNotNone(self.check("gh issue comment 5 --body-file work/ok.md"))

    def test_gitleaksが検出する形も止める(self):
        token = fake_github_token()
        (self.cwd / "work" / "secret.md").write_text(f"token: {token}\n", encoding="utf-8")
        message = self.check("gh issue comment 5 --body-file work/secret.md")
        self.assertIsNotNone(message)
        self.assertIn("gitleaks", message)
        self.assertNotIn(token, message)


class HookScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        (self.tmp / "work").mkdir()
        (self.tmp / "work" / "ok.md").write_text("問題のない本文\n", encoding="utf-8")
        self.term = forbidden_term()
        (self.tmp / "work" / "bad.md").write_text(f"本文に {self.term} が入る\n", encoding="utf-8")
        self.denylist = self.tmp / "denylist.txt"
        self.denylist.write_text(self.term + "\n", encoding="utf-8")

    def run_hook(self, payload=None, raw=None, env=None):
        merged = {**os.environ, "SHIRABE_CHORD_DENYLIST": str(self.denylist), **(env or {})}
        data = raw if raw is not None else json.dumps(payload).encode("utf-8")
        return subprocess.run(["sh", str(HOOK)], input=data, capture_output=True, env=merged)

    def payload(self, command):
        return {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(self.tmp)}

    def without_python(self):
        fake = self.tmp / "fakebin"
        fake.mkdir()
        for name in ("python3", "python"):
            script = fake / name
            script.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8", newline="\n")
            script.chmod(0o755)
        return {"PATH": str(fake) + os.pathsep + os.environ["PATH"]}

    def test_禁止語を含む書き込みは終了コード2で止め語を出さない(self):
        result = self.run_hook(self.payload("gh issue comment 5 --body-file work/bad.md"))
        self.assertEqual(result.returncode, 2, result.stderr.decode("utf-8"))
        self.assertNotIn(self.term, result.stderr.decode("utf-8"))

    def test_検査を通る書き込みは終了コード0で通す(self):
        result = self.run_hook(self.payload("gh issue comment 5 --body-file work/ok.md"))
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))

    def test_ghの語が無ければPythonが無い環境でも通す(self):
        result = self.run_hook(self.payload("git status"), env=self.without_python())
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))

    def test_ghの語があってPythonが無ければ止める(self):
        result = self.run_hook(self.payload("gh issue view 4"), env=self.without_python())
        self.assertEqual(result.returncode, 2)

    def test_壊れたJSONや入力の形が違うときは終了コード2で止める(self):
        self.assertEqual(self.run_hook(raw=b"{not json gh").returncode, 2)
        self.assertEqual(self.run_hook({"tool_name": "Bash", "tool_input": "gh issue view 4"}).returncode, 2)

    def test_settings_jsonにPreToolUseで登録されている(self):
        settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
        entries = [
            (entry["matcher"], hook)
            for entry in settings["hooks"]["PreToolUse"]
            for hook in entry["hooks"]
            if "block-unchecked-gh-writes.sh" in hook["command"]
        ]
        self.assertEqual(len(entries), 1)
        matcher, hook = entries[0]
        self.assertEqual(matcher, "Bash|PowerShell")
        self.assertEqual(hook["timeout"], 60)


if __name__ == "__main__":
    unittest.main()
