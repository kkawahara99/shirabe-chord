import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "cleanup-merged-worktrees.sh"

# `gh pr list --head <branch> --state merged ...` の代役。<FAKE_GH_DIR>/<branch の / を _ にした名前> の中身（headRefOid）を返す。
FAKE_GH = """#!/usr/bin/env bash
branch=""
while [ $# -gt 0 ]; do
  [ "$1" = "--head" ] && branch="$2"
  shift
done
f="$FAKE_GH_DIR/${branch//\\//_}"
[ -f "$f" ] && cat "$f"
exit 0
"""


class CleanupMergedWorktreesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.gh_dir = self.tmp / "gh"
        self.gh_dir.mkdir()
        (self.tmp / "bin").mkdir()
        gh = self.tmp / "bin" / "gh"
        gh.write_text(FAKE_GH, encoding="utf-8", newline="\n")
        gh.chmod(0o755)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "t")
        self.git("config", "user.email", "test@users.noreply.github.com")
        self.git("config", "commit.gpgsign", "false")
        self.commit("base")

    def git(self, *args, cwd=None):
        result = subprocess.run(
            ["git", *args], cwd=cwd or self.repo, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def commit(self, name, cwd=None):
        self.git("commit", "-q", "--allow-empty", "-m", name, cwd=cwd)
        return self.git("rev-parse", "HEAD", cwd=cwd)

    def add_worktree(self, branch, dirname=None):
        path = self.tmp / (dirname or branch.replace("/", "_"))
        self.git("worktree", "add", "-q", str(path), "-b", branch)
        return path

    def merged_pr_head(self, branch, oid):
        (self.gh_dir / branch.replace("/", "_")).write_text(oid + "\n", encoding="utf-8")

    def make_worktree_remove_fail(self):
        # Windows で node_modules などが消しきれず `git worktree remove` が失敗する状況の代役。
        # 実際は登録だけ先に消えて、.git の無いフォルダが残る。それを再現する。
        real_git = Path(shutil.which("git")).as_posix()
        real_rm = Path(shutil.which("rm")).as_posix()  # make_rm_fail の偽物を巻き込まない
        git = self.tmp / "bin" / "git"
        git.write_text(
            "#!/usr/bin/env bash\n"
            f'if [ "$1 $2" = "worktree remove" ]; then "{real_rm}" -f "$3/.git"; "{real_git}" worktree prune; exit 1; fi\n'
            f'exec "{real_git}" "$@"\n',
            encoding="utf-8", newline="\n",
        )
        git.chmod(0o755)

    def make_rm_fail(self):
        rm = self.tmp / "bin" / "rm"
        rm.write_text("#!/usr/bin/env bash\nexit 1\n", encoding="utf-8", newline="\n")
        rm.chmod(0o755)

    def run_hook(self):
        env = {**os.environ, "FAKE_GH_DIR": str(self.gh_dir)}
        env["PATH"] = str(self.tmp / "bin") + os.pathsep + env["PATH"]
        # Windows では PATH 上の bash が WSL のことがあるので、Git の sh 経由で bash を呼ぶ
        result = subprocess.run(
            ["sh", "-c", 'exec bash "$0"', HOOK.as_posix()],
            cwd=self.repo, env=env, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stderr

    def branches(self):
        return self.git("branch", "--format=%(refname:short)").split()

    def test_ローカルHEADがPRの最終コミットと同じなら消す(self):
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.run_hook()
        self.assertFalse(wt.exists())
        self.assertNotIn("feat/a", self.branches())

    def test_worktreeのremoveが失敗しても消しきってブランチも消す(self):
        # 失敗を放置すると、フォルダだけが登録を外れて残り、ブランチも残る（以後フックの対象外になる）
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.make_worktree_remove_fail()
        self.run_hook()
        self.assertFalse(wt.exists())
        self.assertNotIn("feat/a", self.branches())

    def test_消しきれなければブランチを残す(self):
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.make_worktree_remove_fail()
        self.make_rm_fail()
        stderr = self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())
        self.assertIn("by hand", stderr)

    def test_gitが断った場合はフォルダを消さない(self):
        # ロック中は remove が断られ、登録が残る。rm -rf に進んではいけない
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.git("worktree", "lock", str(wt))
        self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())

    def test_空白を含むパスのworktreeも消す(self):
        wt = self.add_worktree("feat/a", dirname="my wt")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.run_hook()
        self.assertFalse(wt.exists())
        self.assertNotIn("feat/a", self.branches())

    def test_ローカルHEADがPRの最終コミットの祖先なら消す(self):
        # PR マージ前に GitHub 側で積まれた main の取り込みを、ローカルが持っていない状況
        wt = self.add_worktree("feat/a")
        self.commit("a", cwd=wt)
        self.merged_pr_head("feat/a", self.commit("merge main into a (remote only)", cwd=wt))
        self.git("reset", "-q", "--hard", "HEAD~1", cwd=wt)
        self.run_hook()
        self.assertFalse(wt.exists())
        self.assertNotIn("feat/a", self.branches())

    def test_PRに含まれないコミットがあれば残す(self):
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        self.commit("unpushed", cwd=wt)
        self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())

    def test_ローカルに無いコミットがPRの最終コミットなら残す(self):
        wt = self.add_worktree("feat/a")
        self.commit("a", cwd=wt)
        self.merged_pr_head("feat/a", "0" * 40)
        self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())

    def test_未コミット変更があれば残す(self):
        wt = self.add_worktree("feat/a")
        self.merged_pr_head("feat/a", self.commit("a", cwd=wt))
        (wt / "dirty.txt").write_text("x", encoding="utf-8")
        self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())

    def test_同名ブランチの複数のマージ済みPRのどれかに含まれれば消す(self):
        wt = self.add_worktree("feat/a")
        head = self.commit("a", cwd=wt)
        (self.gh_dir / "feat_a").write_text("1" * 40 + chr(10) + head + chr(10), encoding="utf-8")
        self.run_hook()
        self.assertFalse(wt.exists())

    def test_マージ済みPRが無ければ残す(self):
        wt = self.add_worktree("feat/a")
        self.commit("a", cwd=wt)
        self.run_hook()
        self.assertTrue(wt.exists())
        self.assertIn("feat/a", self.branches())


if __name__ == "__main__":
    unittest.main()
