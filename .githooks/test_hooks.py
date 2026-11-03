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

from commit_guard import normalize

REPO_ROOT = Path(__file__).resolve().parents[1]
COPIED = [".githooks", ".gitleaks.toml", ".gitignore"]
HOOKS = ["pre-commit", "commit-msg", "pre-merge-commit"]


def _gitleaks() -> str:
    found = os.environ.get("GITLEAKS") or shutil.which("gitleaks")
    if not found:
        raise RuntimeError("gitleaks が見つかりません。PATH に置くか GITLEAKS で指定してください")
    return found


def _random_term() -> str:
    return "zq" + secrets.token_hex(4)


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

    def assert_term_hidden(self, result):
        self.assertNotIn(self.term, normalize(self.output(result)))

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


class TrackedModeTest(unittest.TestCase):
    def test_フックが実行権付きでリポジトリに記録されている(self):
        listed = subprocess.run(
            ["git", "ls-files", "-s", "--", *(f".githooks/{h}" for h in HOOKS)],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout.splitlines()
        modes = {line.split("\t")[1]: line.split()[0] for line in listed}
        self.assertEqual(modes, {f".githooks/{h}": "100755" for h in HOOKS})


if __name__ == "__main__":
    unittest.main()
