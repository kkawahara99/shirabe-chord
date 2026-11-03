import json
import subprocess
import unittest
from pathlib import Path

from block_hook_bypass import find_bypass

HOOK = Path(__file__).resolve().parent / "block-hook-bypass.sh"
NO_VERIFY = "--no-" + "verify"  # このファイル自体を grep したときに紛れないよう組み立てる
HOOKS_PATH = "core." + "hooksPath"

BLOCKED = [
    f"git commit {NO_VERIFY} -m x",
    f"git commit -m x {NO_VERIFY}",
    "git commit -qn -m x",
    "git commit -nm x",
    "git commit -n",
    "git commit -am x -n",
    "git commit --no-verif -m x",
    "cd repo && git commit -m y -n",
    "git -C . commit -n -m x",
    "/usr/bin/git commit -n -m x",
    "git status\ngit commit -n -m x",
    f"git merge {NO_VERIFY} feature",
    f"git push {NO_VERIFY}",
    f"git rebase {NO_VERIFY} main",
    f"git config {HOOKS_PATH} /dev/null",
    f"git config --unset {HOOKS_PATH}",
    f"git config set {HOOKS_PATH} x",
    f"git config --global {HOOKS_PATH} x",
    f"git -c {HOOKS_PATH}=/dev/null commit -m x",
    f"git -C . -c {HOOKS_PATH}=x commit -m x",
    f"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0={HOOKS_PATH} GIT_CONFIG_VALUE_0=x git commit -m x",
    f'git commit -m "unterminated {NO_VERIFY}',
    'sh -c "git commit -n -m x"',
    f"bash -lc 'cd repo && git commit {NO_VERIFY}'",
    'pwsh -Command "git commit -n -m x"',
    "eval git commit -n -m x",
    f"export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0={HOOKS_PATH} GIT_CONFIG_VALUE_0=x; git commit -m x",
    f"$env:GIT_CONFIG_KEY_0='{HOOKS_PATH}'; git commit -m x",
]

# 範囲外として通すと決めた形（変数・別名・スクリプト経由）。allow に無いので権限の確認に任せる
OUT_OF_SCOPE = [
    "g=git; $g commit -n -m x",
    "git ci -n -m x",
    "sh ./commit.sh",
]

ALLOWED = [
    'git commit -m "fix: -n の扱い"',
    f'git commit -m "{NO_VERIFY} を禁止する"',
    'git commit -am "x"',
    "git commit -F message.txt",
    "git commit -S -m x",
    "git merge -n feature",
    "git log -n 5",
    f"git config {HOOKS_PATH}",
    f"git config --get {HOOKS_PATH}",
    f"git config --get-all {HOOKS_PATH}",
    "git config -l",
    "git -c user.name=test commit -m x",
    'sh -c "git status"',
    f"grep -- {NO_VERIFY} .claude/settings.json",
    "python -m unittest discover -s .githooks",
    "git status && git diff --cached",
]


class FindBypassTest(unittest.TestCase):
    def test_検査を外すコマンドを見つける(self):
        for command in BLOCKED:
            with self.subTest(command=command):
                self.assertIsNotNone(find_bypass(command))

    def test_検査を外さないコマンドは通す(self):
        for command in ALLOWED:
            with self.subTest(command=command):
                self.assertIsNone(find_bypass(command))

    def test_範囲外と決めた遠回りな形は通す(self):
        for command in OUT_OF_SCOPE:
            with self.subTest(command=command):
                self.assertIsNone(find_bypass(command))


class HookScriptTest(unittest.TestCase):
    def run_hook(self, payload):
        return subprocess.run(
            ["sh", str(HOOK)], input=json.dumps(payload).encode("utf-8"), capture_output=True
        )

    def test_検査を外すコマンドは終了コード2で止め理由を出す(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": f"git commit -m x {NO_VERIFY}"}})
        self.assertEqual(result.returncode, 2)
        self.assertIn("検出", result.stderr.decode("utf-8"))

    def test_ふつうのコマンドは通す(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "git status"}})
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))

    def test_コマンドの無い入力は通す(self):
        self.assertEqual(self.run_hook({"tool_name": "Bash", "tool_input": {}}).returncode, 0)


if __name__ == "__main__":
    unittest.main()
