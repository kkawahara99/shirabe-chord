"""一時リポジトリにフックを入れ、わざと違反するコミットが止まることを確かめる。

違反の文字列（禁止語・秘密情報・個人情報の形）はテストの実行中に組み立てる。
このファイル自体が検査に掛からず、本物の禁止語リストとも衝突しないようにするため。
"""

import os
import re
import secrets
import shutil
import string
import subprocess
import tempfile
import unittest
from pathlib import Path

from commit_guard import normalize, strip_separators

REPO_ROOT = Path(__file__).resolve().parents[1]
COPIED = [".githooks", ".gitleaks.toml", ".gitignore"]
HOOKS = ["pre-commit", "commit-msg", "pre-merge-commit", "pre-push"]
SCRIPTS = [*HOOKS, "scan-history"]


def _gitleaks() -> str:
    found = os.environ.get("GITLEAKS") or shutil.which("gitleaks")
    if not found:
        raise RuntimeError("gitleaks が見つかりません。PATH に置くか GITLEAKS で指定してください")
    return found


def _random_term() -> str:
    return "zq" + secrets.token_hex(4)


HIRAGANA_POOL = "あいうえおかきくけこさしすせそたちつてとなにぬねの"


def _random_kana_term() -> str:
    return "".join(secrets.choice(HIRAGANA_POOL) for _ in range(5))


def _to_katakana(text: str) -> str:
    return "".join(chr(ord(c) + 0x60) for c in text)


def _fullwidth_upper(text: str) -> str:
    return "".join(chr(ord(c) + 0xFEE0) for c in text.upper())


def _fake_github_token() -> str:
    alphabet = string.ascii_letters + string.digits
    return "ghp" + "_" + "".join(secrets.choice(alphabet) for _ in range(36))


class HookTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        for rel in COPIED:
            src, dst = REPO_ROOT / rel, self.repo / rel
            if src.is_dir():
                shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
            else:
                shutil.copy2(src, dst)

        self.term = _random_term()
        self.denylist = self.tmp / "denylist.txt"
        self.denylist.write_text(f"# テスト用\n{self.term}\n", encoding="utf-8")
        self.env = {**os.environ, "GITLEAKS": _gitleaks(), "SHIRABE_CHORD_DENYLIST": str(self.denylist)}

        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "test")
        self.git("config", "user.email", "test@users.noreply.github.com")
        self.git("config", "core.hooksPath", ".githooks")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", *args], cwd=cwd or self.repo, env=self.env, capture_output=True, text=True, encoding="utf-8"
        )

    def write(self, rel, content, root=None):
        path = (root or self.repo) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8", newline="\n")

    def stage(self, rel, content):
        self.write(rel, content)
        self.assertEqual(self.git("add", "--", rel).returncode, 0)

    def commit(self, message="docs: テスト", cwd=None):
        return self.git("commit", "-q", "-m", message, cwd=cwd)

    def output(self, result):
        return result.stdout + result.stderr

    def assert_passed(self, result):
        self.assertEqual(result.returncode, 0, self.output(result))

    def assert_blocked(self, result):
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assertNotEqual(self.git("rev-parse", "--verify", "-q", "HEAD").returncode, 0, "コミットが作られた")

    def assert_term_hidden(self, result, term=None):
        shown = strip_separators(normalize(self.output(result)))
        self.assertNotIn(normalize(term or self.term), shown)

    def unstage_all(self):
        self.assertEqual(self.git("reset", "-q").returncode, 0)

    def assert_denylist_rule(self, result, location):
        self.assertIn(f"{location}: 禁止語ルール 2", self.output(result))

    def assert_gitleaks_rule(self, result, rule_id):
        self.assertRegex(self.output(result), rf"(?m): gitleaks ルール {re.escape(rule_id)}$")


class DenylistHookTest(HookTestCase):
    def test_違反の無いコミットは通る(self):
        self.stage("note.md", "ふつうの文\n")
        self.assert_passed(self.commit("docs: 追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>"))

    def test_ファイルの中の禁止語で止まり一致した語を出さない(self):
        self.stage("note.md", f"ok\n全角でも {_fullwidth_upper(self.term)} は拾う\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "note.md:2")
        self.assert_term_hidden(result)

    def test_パス名の禁止語で止まりパス名を出さない(self):
        self.stage(f"docs/{self.term}.md", "ok\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("1 番目のファイル", self.output(result))
        self.assert_term_hidden(result)

    def test_UTF16やShiftJISで書いた禁止語でも止まる(self):
        for encoding in ["utf-16", "cp932"]:
            with self.subTest(encoding):
                self.stage("note.txt", f"日本語 {self.term}\n".encode(encoding))
                result = self.commit()
                self.assert_blocked(result)
                self.assert_denylist_rule(result, "note.txt:1")

    def test_文字コードを判別できないファイルで止まる(self):
        self.stage("blob.bin", b"\x81\xff\xfe\x80\xa0")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("検査できません", self.output(result))

    def test_作者名に禁止語の入ったPDFで止まる(self):
        pdf = b"%PDF-1.7\n1 0 obj << /Author (" + self.term.encode() + b") >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
        self.stage("resume.pdf", pdf)
        result = self.commit()
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "resume.pdf:2")

    def test_文字として読めないPDFで止まる(self):
        self.stage("scan.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\nstream\n\x81\xff\xfe\x80\nendstream\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("scan.pdf: 文字コードを判別できない", self.output(result))

    def test_禁止語を含む名前のサブモジュールで止まり名前を出さない(self):
        # サブモジュールの参照先のコミットは、手元に無くてもインデックスに登録できる
        result = self.git("update-index", "--add", "--cacheinfo", f"160000,{'1' * 40},vendor/{self.term}")
        self.assertEqual(result.returncode, 0, self.output(result))
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("1 番目のファイル", self.output(result))
        self.assertNotIn("Traceback", self.output(result))
        self.assert_term_hidden(result)

    def test_ShiftJISで書いたコミットメッセージの禁止語で止まる(self):
        self.stage("note.md", "ok\n")
        message = self.tmp / "message.txt"
        message.write_bytes(f"docs: 日本語 {self.term}\n".encode("cp932"))
        result = self.git("commit", "-q", "-F", str(message))
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "コミットメッセージ:1")

    def test_コミットメッセージの禁止語で止まる(self):
        self.stage("note.md", "ok\n")
        result = self.commit(f"docs: {self.term}の件")
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "コミットメッセージ:1")
        self.assert_term_hidden(result)

    def test_ひらがなの禁止語がカタカナの内容・パス名・コミットメッセージで止まる(self):
        hira = _random_kana_term()
        kata = _to_katakana(hira)
        for label, listed, written in [("ひらがなの語", hira, kata), ("カタカナの語", kata, hira)]:
            self.denylist.write_text(f"# テスト用\n{listed}\n", encoding="utf-8")
            with self.subTest(label, 場所="内容"):
                self.unstage_all()
                self.stage("note.md", f"ok\n{written}\n")
                result = self.commit()
                self.assert_blocked(result)
                self.assert_denylist_rule(result, "note.md:2")
                self.assert_term_hidden(result, listed)
            with self.subTest(label, 場所="パス名"):
                self.unstage_all()
                self.stage(f"docs/{written}.md", "ok\n")
                result = self.commit()
                self.assert_blocked(result)
                self.assertIn("1 番目のファイル", self.output(result))
                self.assert_term_hidden(result, listed)
            with self.subTest(label, 場所="コミットメッセージ"):
                self.unstage_all()
                self.stage("note.md", "ok\n")
                result = self.commit(f"docs: {written}の件")
                self.assert_blocked(result)
                self.assert_denylist_rule(result, "コミットメッセージ:1")
                self.assert_term_hidden(result, listed)

    def test_空白・記号・ゼロ幅文字で区切った書き方で止まる(self):
        for separator in [" ", "-", "・", "|", "​"]:
            with self.subTest(separator=repr(separator)):
                self.stage("note.md", f"ok\n{separator.join(self.term)}\n")
                result = self.commit()
                self.assert_blocked(result)
                self.assert_denylist_rule(result, "note.md:2")
                self.assert_term_hidden(result)

    def test_改行をまたぐ書き方で止まり行番号は先頭の行(self):
        head, tail = self.term[:4], self.term[4:]
        self.stage("note.md", f"ok\n{head}\n{tail}\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "note.md:2")
        self.assert_term_hidden(result)

        self.unstage_all()
        self.stage("note.md", "ok\n")
        result = self.commit(f"docs: テスト\n\n{head}\n{tail}")
        self.assert_blocked(result)
        self.assert_denylist_rule(result, "コミットメッセージ:3")
        self.assert_term_hidden(result)

    def test_区切りを入れたパス名で止まりパス名を出さない(self):
        self.stage(f"docs/{self.term[:4]}-{self.term[4:]}.md", "ok\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("1 番目のファイル", self.output(result))
        self.assert_term_hidden(result)

    def test_短い語が入った禁止語リストでも無関係なコミットは通る(self):
        self.denylist.write_text(f"# テスト用\n{self.term}\nxy\n--\nゐ\n。。\n", encoding="utf-8")
        self.stage("note.md", "Hello, world.\n文章です。\n")
        self.assert_passed(self.commit("docs: 追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>"))

    def test_禁止語リストが無ければ止まる(self):
        self.denylist.unlink()
        self.stage("note.md", "ok\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("禁止語リストがありません", self.output(result))

    def test_禁止語リストがコメントだけなら止まる(self):
        self.denylist.write_text("# まだ空\n\n", encoding="utf-8")
        self.stage("note.md", "ok\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("禁止語リストに語がありません", self.output(result))

    def test_worktreeからでもメインの作業ツリーの禁止語リストを使う(self):
        del self.env["SHIRABE_CHORD_DENYLIST"]
        self.write("private/denylist.txt", f"# テスト用\n{self.term}\n")
        # worktree でフックが動くのは、.githooks/ がコミットされて checkout されるから
        self.git("add", *COPIED)
        self.assert_passed(self.commit("chore: フックを入れる"))
        worktree = self.tmp / "wt"
        self.assertEqual(self.git("worktree", "add", "-q", str(worktree), "-b", "feature").returncode, 0)

        self.write("note.md", f"{self.term}\n", root=worktree)
        self.git("add", "note.md", cwd=worktree)
        result = self.commit(cwd=worktree)
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assert_denylist_rule(result, "note.md:1")


class PrivateDirHookTest(HookTestCase):
    def test_privateを強制的にステージしても止まりファイル名を出さない(self):
        self.write("private/raw.md", "生の回答\n")
        self.assertEqual(self.git("add", "-f", "private/raw.md").returncode, 0)
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("private/ のファイルが 1 件", self.output(result))
        self.assertNotIn("raw.md", self.output(result))

    def test_誤ってコミットしたprivateのファイルを外すコミットは通る(self):
        self.write("private/raw.md", "生の回答\n")
        self.git("add", "-f", "private/raw.md")
        self.assertNotEqual(self.commit().returncode, 0)
        # 検査を外した状態で入ってしまったものとして、フックなしで入れてから外す
        self.git("config", "core.hooksPath", str(self.tmp / "no-hooks"))
        self.assert_passed(self.commit())
        self.git("config", "core.hooksPath", ".githooks")
        self.git("rm", "-q", "--cached", "private/raw.md")
        self.assert_passed(self.commit("chore: private を外す"))


class GitleaksHookTest(HookTestCase):
    def test_ファイルの中の秘密情報で止まり値も同じ行の残りも出さない(self):
        token = _fake_github_token()
        self.stage("config.txt", f"{self.term} token = {token}\n")
        self.env["SHIRABE_CHORD_DENYLIST"] = str(self.tmp / "other.txt")
        (self.tmp / "other.txt").write_text("unrelated-term\n", encoding="utf-8")
        result = self.commit()
        self.assert_blocked(result)
        self.assert_gitleaks_rule(result, "github-pat")
        self.assertNotIn(token, self.output(result))
        self.assert_term_hidden(result)

    def test_コミットメッセージの秘密情報で止まる(self):
        self.stage("note.md", "ok\n")
        result = self.commit(f"chore: token {_fake_github_token()}")
        self.assert_blocked(result)
        self.assert_gitleaks_rule(result, "github-pat")

    def test_独自ルールの個人情報や識別子で止まる(self):
        account = "2109" + "87654321"
        backslash = "\\"
        cases = [
            ("email-address", "連絡先 someone" + "@gmail.com"),
            ("email-address", "other" + "@github.com"),
            ("jp-phone-number", "電話 090" + "-1234-5678"),
            ("jp-postal-code", "〒100" + "-0001"),
            ("aws-arn-with-account", f"arn:aws:iam::{account}:role/x"),
            ("aws-account-id", f'account_id = "{account}"'),
            ("aws-account-id", f'{{"Account": "{account}"}}'),
            ("aws-account-id", f"AWS_ACCOUNT={account}"),
            ("aws-account-id", f"アカウントID：{account}"),
            ("local-home-path", "C:" + backslash + "Users" + backslash + "someone" + backslash + "projects"),
            ("local-home-path", "c:" + backslash + "users" + backslash + "someone"),
            ("local-home-path", '{"p": "C:' + backslash * 2 + "Users" + backslash * 2 + 'someone"}'),
            ("local-home-path", "cd /c/" + "Users/someone/projects"),
            ("local-home-path", "cd /" + "home/someone/projects"),
            ("local-home-path", "C:/" + "Users/someone/projects"),
            ("local-home-path", "/mnt/c/" + "Users/someone/projects"),
            ("local-home-path", "`/" + "Users/someone/x` と `/" + "home/someone/x`"),
            ("local-home-path", "file:///" + "Users/someone/x"),
            ("local-home-path", "PATH=/usr/bin:/" + "home/someone/bin"),
            ("aws-account-id", f"AWSアカウントID {account}"),
            ("aws-account-id", "アカウントID: 2109-" + "8765-4321"),
            ("aws-account-id", f'"OwnerId": "{account}"'),
            ("aws-account-id", f"Account ID: {account}"),
            ("aws-account-id", f"AWS Account ID {account}"),
            ("aws-account-id", "Account ID 2109-" + "8765-4321"),
            ("aws-account-id", f"| Account ID | {account} |"),
            ("aws-account-id", f"Owner ID: {account}"),
        ]
        for rule_id, text in cases:
            with self.subTest(rule_id=rule_id, text=text):
                self.stage("note.md", text + "\n")
                result = self.commit()
                self.assert_blocked(result)
                self.assert_gitleaks_rule(result, rule_id)

    def _bucket_cases(self, account):
        # S3 のバケット名の形（ADR 0005）。リテラルで書くと自分の検査に止められるので組み立てる
        tail = "-" + account + "-ap-northeast-1" + "-an"
        return [
            "shirabe-chord-site" + tail,
            "shirabe-chord-site-" + account + "-us-east-1" + "-an",
            "shirabe-chord-site-" + account + "-us-gov-west-1" + "-an",
            "shirabe-chord-site" + tail + ".s3.ap-northeast-1.amazonaws.com",
            "s3://shirabe-chord-site" + tail + "/index.html",
        ]

    def test_バケット名の中のアカウントIDで止まり値を出さない(self):
        account = "2109" + "87654321"
        for text in self._bucket_cases(account):
            with self.subTest(text=text):
                self.stage("note.md", text + "\n")
                result = self.commit()
                self.assert_blocked(result)
                self.assert_gitleaks_rule(result, "aws-account-id-in-bucket-name")
                self.assertNotIn(account, self.output(result))

    def test_コミットメッセージのバケット名の中のアカウントIDで止まり値を出さない(self):
        account = "2109" + "87654321"
        self.stage("note.md", "ok\n")
        result = self.commit("docs: " + self._bucket_cases(account)[0])
        self.assert_blocked(result)
        self.assert_gitleaks_rule(result, "aws-account-id-in-bucket-name")
        self.assertNotIn(account, self.output(result))

    def test_架空のアカウントIDや形が違うバケット名では止まらない(self):
        lines = self._bucket_cases("123456789012")
        lines += [
            "shirabe-chord-site-" + "210987654321" + "-ap-northeast-1",
            "shirabe-chord-site-" + "21098765432" + "-ap-northeast-1-an",
            "shirabe-chord-site-" + "2109876543210" + "-ap-northeast-1-an",
        ]
        self.stage("note.md", "\n".join(lines) + "\n")
        self.assert_passed(self.commit("docs: 追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>"))

    def test_許可した形や紛らわしい形では止まらない(self):
        self.stage(
            "note.md",
            "\n".join(
                [
                    "例 someone" + "@example.com / git" + "@github.com / icon" + "@2x.png",
                    "noreply" + "@github.com / NoReply" + "@GitHub.com",
                    "1" + "@users.noreply.github.com",
                    "arn:aws:iam::123456789012:role/x / account_id = 123456789012",
                    "arn:aws:s3:::my-bucket/key",
                    "日付 2026-10-15、ADR 0002-iac-tool",
                    "C:" + "\\Users\\<user>\\ / /home/runner/work / /Users/Shared/x",
                    "https://example.com/home/page と https://example.com/users/list",
                    "GET /users/octocat/repos",
                ]
            )
            + "\n",
        )
        self.assert_passed(self.commit("docs: 追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>"))

    def test_gitleaksが無ければ止まる(self):
        self.env["GITLEAKS"] = "gitleaks-does-not-exist"
        self.stage("note.md", "ok\n")
        result = self.commit()
        self.assert_blocked(result)
        self.assertIn("gitleaks が見つかりません", self.output(result))


class MergeHookTest(HookTestCase):
    def test_自動のマージコミットでも止まる(self):
        self.stage("base.md", "ok\n")
        self.assert_passed(self.commit())
        self.git("switch", "-q", "-c", "feature")
        # ブランチ側には、検査を外した状態で禁止語が入ってしまったものとする
        self.git("config", "core.hooksPath", str(self.tmp / "no-hooks"))
        self.stage("leak.md", f"{self.term}\n")
        self.assert_passed(self.commit())
        self.git("config", "core.hooksPath", ".githooks")
        self.git("switch", "-q", "main")

        result = self.git("merge", "--no-ff", "-q", "-m", "chore: マージ", "feature")
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assert_denylist_rule(result, "leak.md:1")
        self.assertEqual(self.git("rev-list", "--count", "HEAD").stdout.strip(), "1")


class PushTestCase(HookTestCase):
    """リモート役のベアリポジトリを持つ。違反するコミットは、検査を外して作る。"""

    def setUp(self):
        super().setUp()
        self.remote = self.tmp / "remote.git"
        subprocess.run(["git", "init", "--bare", "-q", "-b", "main", str(self.remote)], check=True, env=self.env)
        self.git("remote", "add", "origin", str(self.remote))
        self.no_hooks = ["-c", f"core.hooksPath={self.tmp / 'no-hooks'}"]

    def commit_file(self, rel="note.md", content="ok\n", message="docs: テスト", bypass=False, config=(), extra=()):
        self.stage(rel, content)
        flags = [*self.no_hooks] if bypass else []
        for item in config:
            flags += ["-c", item]
        self.assert_passed(self.git(*flags, "commit", "-q", "-m", message, *extra))
        return self.sha()

    def sha(self, rev="HEAD"):
        return self.git("rev-parse", rev).stdout.strip()

    def short(self, rev="HEAD"):
        return self.sha(rev)[:8]

    def push(self, *args, remote="origin", bypass=False):
        flags = [*self.no_hooks] if bypass else []
        return self.git(*flags, "push", "-q", remote, *args)

    def remote_sha(self, ref="refs/heads/main"):
        result = subprocess.run(
            ["git", "-C", str(self.remote), "rev-parse", "--verify", "-q", ref], capture_output=True, text=True
        )
        return result.stdout.strip() or None

    def assert_pushed(self, result, ref="refs/heads/main"):
        self.assert_passed(result)
        self.assertEqual(self.remote_sha(ref), self.sha(ref))

    def assert_push_blocked(self, result, ref="refs/heads/main", before=None):
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assertEqual(self.remote_sha(ref), before, "push が通ってしまった")

    def set_denylist(self, *terms):
        self.denylist.write_text("# テスト用\n" + "".join(f"{t}\n" for t in terms), encoding="utf-8")

    def ident(self, name, email):
        return [f"user.name={name}", f"user.email={email}"]


class PrePushHookTest(PushTestCase):
    def test_検査を通るコミットはpushできる(self):
        self.commit_file(message="docs: 追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
        self.assert_pushed(self.push("main"))

    def test_ブランチの削除のpushは検査しない(self):
        self.commit_file()
        self.assert_passed(self.push("main", "main:refs/heads/other"))
        self.assertEqual(self.remote_sha("refs/heads/other"), self.sha())
        self.denylist.unlink()
        result = self.push("--delete", "other")
        self.assert_passed(result)
        self.assertIsNone(self.remote_sha("refs/heads/other"))

    def test_cherry_pickで作った禁止語入りコミットのpushが止まり語を出さない(self):
        self.set_denylist("unrelated-term")
        self.commit_file("base.md")
        self.assert_pushed(self.push("main"))
        self.git("switch", "-q", "-c", "feature")
        self.commit_file("leak.md", f"ok\n{self.term}\n")
        self.git("switch", "-q", "main")
        self.set_denylist(self.term)  # 禁止語は後から足された
        self.assert_passed(self.git("cherry-pick", "feature"))  # フックは呼ばれない

        before = self.remote_sha()
        result = self.push("main")
        self.assert_push_blocked(result, before=before)
        self.assertIn(f"blob {self.sha('HEAD:leak.md')[:8]}:2: 禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_rebaseで作った禁止語入りコミットのpushが止まり語を出さない(self):
        self.set_denylist("unrelated-term")
        self.commit_file("base.md")
        self.assert_pushed(self.push("main"))
        self.git("switch", "-q", "-c", "feature")
        self.commit_file("leak.md", f"ok\n{self.term}\n")
        self.git("switch", "-q", "main")
        self.commit_file("next.md")
        self.set_denylist(self.term)
        self.git("switch", "-q", "feature")
        self.assert_passed(self.git("rebase", "main"))  # フックは呼ばれない

        result = self.push("feature")
        self.assert_push_blocked(result, "refs/heads/feature")
        self.assertIn("禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_リネームだけで禁止語入りのパス名に変えたコミットのpushが止まりパス名を出さない(self):
        self.commit_file("docs/old.md")
        self.assert_pushed(self.push("main"))
        before = self.remote_sha()
        self.assert_passed(self.git("mv", "docs/old.md", f"docs/{self.term}.md"))
        self.assert_passed(self.git(*self.no_hooks, "commit", "-q", "-m", "docs: 名前を変える"))

        result = self.push("main")
        self.assert_push_blocked(result, before=before)
        self.assertIn(f"{self.short()} の 1 番目のファイル", self.output(result))
        self.assertIn("のパス名: 禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_コミットメッセージの禁止語でpushが止まり短縮ハッシュと行番号だけ出る(self):
        self.commit_file(message=f"docs: {self.term}の件", bypass=True)
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn(f"{self.short()} コミットメッセージ:1: 禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_コミットメッセージの秘密情報でpushが止まり短縮ハッシュで特定される(self):
        token = _fake_github_token()
        before = self.commit_file("a.md", message="docs: 問題なし")
        leaky = self.commit_file("b.md", message=f"chore: token {token}", bypass=True)
        after = self.commit_file("c.md", message="docs: これも問題なし")
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assert_gitleaks_rule(result, "github-pat")
        self.assertIn(leaky[:8], self.output(result))
        # 特定は、そのコミット 1 つのメッセージだけを流し直す（前後のコミットは出ない）
        self.assertNotIn(before[:8], self.output(result))
        self.assertNotIn(after[:8], self.output(result))
        self.assertNotIn(token, self.output(result))

    def test_マージの解決で入った秘密情報でpushが止まる(self):
        token = _fake_github_token()
        self.commit_file("base.md")
        self.git("switch", "-q", "-c", "side")
        self.commit_file("side.md")
        self.git("switch", "-q", "main")
        self.commit_file("main.md")
        self.assert_passed(self.git(*self.no_hooks, "merge", "--no-commit", "--no-ff", "side"))
        self.write("evil.txt", f"token = {token}\n")
        self.git("add", "--", "evil.txt")
        self.assert_passed(self.git(*self.no_hooks, "commit", "-q", "-m", "chore: マージ"))
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assert_gitleaks_rule(result, "github-pat")
        self.assertNotIn(token, self.output(result))

    def test_追加された中身の秘密情報でpushが止まる(self):
        token = _fake_github_token()
        self.commit_file("config.txt", f"token = {token}\n", bypass=True)
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assert_gitleaks_rule(result, "github-pat")
        self.assertNotIn(token, self.output(result))

    def test_範囲の途中のコミットの違反でも止まる(self):
        self.commit_file("a.md")
        middle = self.commit_file("b.md", message=f"docs: {self.term}", bypass=True)
        self.commit_file("c.md")
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn(f"{middle[:8]} コミットメッセージ:1: 禁止語ルール 2", self.output(result))
        self.assertNotIn(self.short(), self.output(result))

    def test_作者が許す形でないコミットで止まり名前とメールを出さない(self):
        name, email = "Zz" + secrets.token_hex(4), "zz" + secrets.token_hex(4) + "@example.org"
        self.commit_file(extra=["--author", f"{name} <{email}>"])
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn(f"{self.short()} 作者", self.output(result))
        for secret in [name, email, email.split("@")[0]]:
            self.assertNotIn(secret, self.output(result))

    def test_コミッターが許す形でないコミットで止まり名前とメールを出さない(self):
        name, email = "Zz" + secrets.token_hex(4), "zz" + secrets.token_hex(4) + "@example.org"
        self.commit_file(config=self.ident(name, email), extra=["--author", "test <test@users.noreply.github.com>"])
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn(f"{self.short()} コミッター", self.output(result))
        for secret in [name, email, email.split("@")[0]]:
            self.assertNotIn(secret, self.output(result))

    def test_名前とメールのユーザー名が違うコミットで止まる(self):
        self.commit_file(config=self.ident("other", "test@users.noreply.github.com"))
        self.assert_push_blocked(self.push("main"))

    def test_数字付きのnoreplyと名前の大文字小文字違いは通る(self):
        cases = [("TEST", "12345+test@users.noreply.github.com"), ("test", "Test@Users.NoReply.GitHub.com")]
        for i, (name, email) in enumerate(cases):
            with self.subTest(name=name, email=email):
                self.commit_file(f"n{i}.md", config=self.ident(name, email))
                self.assert_pushed(self.push("main"))

    def test_コミッターがGitHubの組なら通り作者がその組なら止まる(self):
        github = self.ident("GitHub", "noreply@github.com")
        self.commit_file("a.md", config=github, extra=["--author", "test <test@users.noreply.github.com>"])
        self.assert_pushed(self.push("main"))

        before = self.remote_sha()
        self.commit_file("b.md", config=github)
        self.assert_push_blocked(self.push("main"), before=before)

    def test_GitHubの組に似た別の組のコミッターは止まる(self):
        author = ["--author", "test <test@users.noreply.github.com>"]
        self.commit_file("base.md")
        self.assert_pushed(self.push("main"))
        before = self.remote_sha()
        for name, email in [("GitHub", "other" + "@github.com"), ("someone", "noreply@github.com")]:
            with self.subTest(name=name, email=email):
                self.commit_file("x.md", config=self.ident(name, email), extra=author)
                self.assert_push_blocked(self.push("main"), before=before)
                self.git("reset", "-q", "--hard", "HEAD~1")

    def test_作者とコミッターの行には禁止語の照合をかけない(self):
        self.commit_file(config=self.ident(self.term, f"{self.term}@users.noreply.github.com"))
        self.assert_pushed(self.push("main"))

    def test_禁止語を含むブランチ名のpushが止まり名前を出さない(self):
        self.commit_file()
        self.git("switch", "-q", "-c", f"feature/{self.term}")
        result = self.push(f"feature/{self.term}")
        self.assert_push_blocked(result, f"refs/heads/feature/{self.term}")
        self.assertIn("禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_禁止語を含むタグ名のpushが止まり名前を出さない(self):
        self.commit_file()
        self.git("tag", f"v-{self.term}")
        result = self.push(f"v-{self.term}")
        self.assert_push_blocked(result, f"refs/tags/v-{self.term}")
        self.assertIn("禁止語ルール 2", self.output(result))
        self.assert_term_hidden(result)

    def test_すでにリモートにあるコミットは再検査しない(self):
        self.commit_file("bad.md", f"{self.term}\n", bypass=True)
        self.assert_pushed(self.push("main", bypass=True))
        self.commit_file("good.md")
        self.assert_pushed(self.push("main"))

    def test_リモートをURLで指定したpushは範囲を絞れず全履歴を検査する(self):
        self.commit_file("bad.md", f"{self.term}\n", bypass=True)
        self.assert_pushed(self.push("main", bypass=True))
        self.commit_file("good.md")
        before = self.remote_sha()
        result = self.push("main", remote=str(self.remote))
        self.assert_push_blocked(result, before=before)
        self.assert_denylist_rule(result, f"blob {self.sha('HEAD~1:bad.md')[:8]}:1")

    def test_禁止語リストが無ければpushが止まる(self):
        self.commit_file()
        self.denylist.unlink()
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn("禁止語リストがありません", self.output(result))

    def test_gitleaksが無ければpushが止まる(self):
        self.commit_file()
        self.env["GITLEAKS"] = "gitleaks-does-not-exist"
        result = self.push("main")
        self.assert_push_blocked(result)
        self.assertIn("gitleaks が見つかりません", self.output(result))


class ScanHistoryTest(PushTestCase):
    def scan(self):
        # sh の場所に頼らないよう、git のエイリアスとして（git 付属の sh で）動かす
        return self.git("-c", "alias.scanhist=!sh .githooks/scan-history", "scanhist")

    def test_違反が無ければ終了コード0(self):
        self.commit_file("a.md")
        self.commit_file("b.md")
        self.assert_passed(self.scan())

    def test_履歴の違反を報告し語も名前も出さない(self):
        token = _fake_github_token()
        name = "Zz" + secrets.token_hex(4)
        self.commit_file("content.md", f"{self.term}\n", bypass=True)
        self.commit_file(f"{self.term}.md", bypass=True)
        self.commit_file("m.md", message=f"chore: token {token}", bypass=True)
        self.commit_file("a.md", config=self.ident(name, "zz@example.org"))
        result = self.scan()
        self.assertNotEqual(result.returncode, 0, self.output(result))
        out = self.output(result)
        self.assertIn(f"blob {self.sha('HEAD~3:content.md')[:8]}:1: 禁止語ルール 2", out)
        self.assertIn("のパス名: 禁止語ルール 2", out)
        self.assert_gitleaks_rule(result, "github-pat")
        self.assertIn(f"{self.short()} 作者", out)
        self.assert_term_hidden(result)
        self.assertNotIn(token, out)
        self.assertNotIn(name, out)

    def test_現在のブランチ以外のブランチにだけあるコミットも拾う(self):
        self.commit_file("a.md")
        self.git("switch", "-q", "-c", "side")
        self.commit_file("b.md", message=f"docs: {self.term}", bypass=True)
        self.git("switch", "-q", "main")
        result = self.scan()
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assert_denylist_rule(result, f"{self.short('side')} コミットメッセージ:1")

    def test_タグにだけあるコミットも拾う(self):
        self.commit_file("a.md")
        self.git("switch", "-q", "--detach")
        self.commit_file("b.md", message=f"docs: {self.term}", bypass=True)
        self.git("tag", "only-tag")
        self.git("switch", "-q", "main")
        result = self.scan()
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assert_denylist_rule(result, f"{self.short('only-tag')} コミットメッセージ:1")

    def test_リモート追跡ブランチにだけあるコミットも拾う(self):
        self.commit_file("a.md")
        self.git("switch", "-q", "-c", "side")
        self.commit_file("b.md", message=f"docs: {self.term}", bypass=True)
        self.assert_passed(self.push("side", bypass=True))
        bad = self.short()
        self.git("switch", "-q", "main")
        self.git("branch", "-q", "-D", "side")
        result = self.scan()
        self.assertNotEqual(result.returncode, 0, self.output(result))
        self.assert_denylist_rule(result, f"{bad} コミットメッセージ:1")

    def test_stashの中だけにある違反は出ない(self):
        self.commit_file("a.md")
        self.write("a.md", f"{self.term}\ntoken = {_fake_github_token()}\n")
        self.assert_passed(self.git("stash", "push", "-q"))
        self.assert_passed(self.git("rev-parse", "--verify", "-q", "refs/stash"))
        self.assert_passed(self.scan())


class TrackedModeTest(unittest.TestCase):
    def test_フックが実行権付きでリポジトリに記録されている(self):
        listed = subprocess.run(
            ["git", "ls-files", "-s", "--", *(f".githooks/{h}" for h in SCRIPTS)],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout.splitlines()
        modes = {line.split("\t")[1]: line.split()[0] for line in listed}
        self.assertEqual(modes, {f".githooks/{h}": "100755" for h in SCRIPTS})


if __name__ == "__main__":
    unittest.main()
