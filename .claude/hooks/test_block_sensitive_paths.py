import json
import subprocess
import unittest
from pathlib import Path

from block_sensitive_paths import PROTECTED, find_in_command, find_sensitive

HOOK = Path(__file__).resolve().parent / "block-sensitive-paths.sh"
HOME = "C:\\Users\\user"
CWD = "C:\\Users\\user\\projects\\repo"

# 保護した場所を指すコマンド。同じ場所の書き方の違い（~・変数・絶対パス・相対・大文字小文字・区切り）をそろえて止める
BLOCKED = [
    "ls ~/Downloads",
    "ls -la ~/Downloads/",
    "cat ~/.ssh/id_ed25519",
    "cat ~/.aws/credentials",
    "cat ~/.config/gh/hosts.yml",
    "cat ~/.terraform.d/credentials.tfrc.json",
    "cat ~/.git-credentials",
    "ls $HOME/Downloads",
    "ls ${HOME}/Downloads",
    "ls $env:USERPROFILE\\Downloads",
    "Get-ChildItem -Path $HOME\\Downloads",
    "Get-ChildItem -Path:$HOME\\Downloads",
    "dir %USERPROFILE%\\Downloads",
    "ls C:\\Users\\user\\Downloads",
    "ls C:/Users/user/Downloads",
    'ls "C:\\Users\\user\\Downloads"',
    "ls /c/Users/user/Downloads",
    "ls /mnt/c/Users/user/Downloads",
    "ls c:/users/user/DOWNLOADS",
    "ls ../../Downloads",
    "ls ../../../user/./Downloads/../Downloads",
    "ls ~/OneDrive/Downloads",
    "ls ~/Down*",
    "ls ~/.ssh/id_*",
    "ls ~/.s*",
    "ls ~/*",
    "cat ~/.ssh/id_rsa | head",
    "git status && cat ~/.aws/config",
    "cd ~/Downloads && ls",
    "cd ~ && cd Downloads && ls",
    "cd ../.. ; ls Downloads",
    'sh -c "cat ~/.ssh/id_rsa"',
    "pwsh -Command \"Get-Content $HOME\\.ssh\\id_rsa\"",
    "FOO=~/.aws/credentials env",
    "terraform plan -var-file=~/Downloads/x.tfvars",
    "cat < ~/.ssh/id_rsa",
    "ls $X/Downloads",
    "cat $DIR/.ssh/id_rsa",
    'cat "~/.ssh/id_rsa',
    "ls ~/AppData/Local/Google/Chrome/User\\ Data",
    "ls ~/AppData/Roaming/Mozilla/Firefox",
    # 再帰して探す操作の起点が、保護した場所を含む上位の場所
    "find ~ -iname '*.zip'",
    "find / -name '*.zip'",
    "find ../.. -name x",
    "ls -R ~",
    "ls -lR ~/",
    "rg token ~",
    "grep -r token ~",
    "grep -rn token $HOME",
    "Get-ChildItem ~ -Recurse",
    "gci -r C:\\Users\\user",
    "tree ~",
    "du -sh ~",
    # 書き方の揺れ
    "ls ~/{Downloads,x}",
    "ls file:///C:/Users/user/Downloads",
    "ls ~user/Downloads",
    "ls $env:HOMEDRIVE$env:HOMEPATH\\Downloads",
    "cd; ls .ssh",
    "Push-Location ~/Downloads",
    'echo "$(cat ~/.ssh/id_rsa)"',
    "echo `cat ~/.aws/credentials`",
    "git commit -m \"$(cat ~/.ssh/id_rsa)\"",
    # 改行で区切った複数行のコマンド
    "git status\nfind ~ -name x",
    "cd ~\nls Downloads",
    "Write-Output a\nGet-ChildItem ~ -Recurse",
    "echo ok\ncat ~/.ssh/id_rsa",
    # 起点を省いたり、前置きを付けたり、書き方を変えた再帰検索
    "sudo find ~ -name x",
    "env FOO=1 rg token ~",
    "timeout 5 find ~ -name x",
    "cd && find -name x",
    "cd ~ && grep -r token",
    "cd ~ && rg token",
    "Get-ChildItem -Path:~ -Recurse",
    "Get-ChildItem ~ -Depth 3",
    "find /c -name x",
    "find C: -name x",
    "rg -e token ~",
    "rg --files ~",
    "rg --files -g '*.zip' ~",
    "fd zip ~",
    "fd . ~",
    # 引用符の数が合わず解析できないコマンドでも、再帰検索は見る
    "echo it's; find ~ -name x",
    "# it's fine\nfind ~ -name x",
]

# 同じ名前でも、保護した場所を指さないもの。コミットメッセージや検索語、リポ内の同名フォルダは通す
ALLOWED = [
    "ls",
    "ls -la .claude",
    "ls ../",
    "ls Downloads",
    "ls ./downloads/",
    "cat docs/ssh.md",
    "git status && git diff --cached",
    'git commit -m "docs: Downloads を読まない"',
    'git commit -m "docs: ~/Downloads の扱い"',
    "git commit -m 'chore: .aws と .ssh を deny に足す'",
    "rg Downloads .claude",
    "rg '\\.ssh' docs",
    "git log --grep=Downloads",
    "ls ~/projects",
    "ls ~",
    "ls ~/.config",
    "ls ~/.sshd_notes",
    "ls ~/DownloadsOld",
    "ls ~/Desktop",
    "cd ~ && ls projects",
    "cd .. && ls",
    "python -m unittest discover -s .claude/hooks",
    "terraform -chdir=infra/bootstrap validate",
    "ls /tmp",
    "ls /c/Users/username/Downloads",
    "echo $X",
    "date +%Y",
    "ls C:/Users/user/AppData/Local/Temp/claude",
    'sh -c "git status"',
    # 文章の中の言及。空白を含む語と、heredoc の本文はパスとして調べない
    'echo "$X ~/.ssh/ を読まない"',
    "git commit -m \"$(cat <<'EOF'\nfix: ~/Downloads/ と ~/.aws/credentials を保護する\n\n本文に $HOME/.ssh を書く\nEOF\n)\"",
    "git commit -F - <<'EOF'\nchore: ~/Downloads の扱い\nEOF",
    "cat <<EOF > notes.txt\n~/.ssh/id_rsa\nEOF",
    # 上位の場所でも、再帰しないか、保護した場所を含まない
    "rg token ~/projects",
    "rg token .",
    "grep token ~",
    "find . -name '*.zip'",
    "ls -R .claude",
    "ls ~/.config",
    # 検索語が ~ や $HOME や / に見えても、起点ではない
    "rg -n '~' .claude/hooks",
    "rg -n '$HOME' docs",
    "rg '%USERPROFILE%' docs",
    "rg -e '~/' docs",
    "rg -F '/' docs",
    "grep -rn '/' docs",
    "rg '\\.' docs",
    "rg --max-depth 2 '~' docs",
    "rg -j 4 '/' docs",
    "rg -r x '~' docs",
    "grep -rn --exclude-dir node_modules '~' .",
    "fd '~'",
    "git status\nls -la\nrg token .",
    "cd ~/projects\nrg token .",
]

# ツールごとの入力。Grep の pattern は正規表現なので、保護した場所の名前が入っていても通す
TOOL_BLOCKED = [
    {"tool_name": "Read", "tool_input": {"file_path": "C:\\Users\\user\\Downloads\\icons.zip"}},
    {"tool_name": "Read", "tool_input": {"file_path": "~/.aws/credentials"}},
    {"tool_name": "Read", "tool_input": {"file_path": "c:/users/user/downloads/x"}},
    {"tool_name": "Read", "tool_input": {"file_path": "../../Downloads/x"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "*.zip", "path": "~/Downloads"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "~/Downloads/**"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "x", "path": "C:/Users/user/.ssh"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "x", "glob": "~/.aws/*"}},
    # 上位の場所を起点にした探索。pattern は path を基準に解釈される
    {"tool_name": "Glob", "tool_input": {"pattern": "*.zip", "path": "~"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "Downloads/*.zip", "path": "C:\\Users\\user"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "token", "path": "$HOME"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "x", "path": "C:\\Users\\user", "glob": ".ssh/*"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "~/**/*.zip"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "C:/Users/user/**/*.zip"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "/c/Users/user/**/*.zip"}},
    # 書き込み系
    {"tool_name": "Write", "tool_input": {"file_path": "~/.ssh/authorized_keys", "content": "x"}},
    {"tool_name": "Edit", "tool_input": {"file_path": "C:\\Users\\user\\.aws\\config"}},
    {"tool_name": "NotebookEdit", "tool_input": {"notebook_path": "~/Downloads/a.ipynb"}},
]
TOOL_ALLOWED = [
    {"tool_name": "Read", "tool_input": {"file_path": "C:\\Users\\user\\projects\\repo\\CLAUDE.md"}},
    {"tool_name": "Read", "tool_input": {"file_path": "docs/adr/0002-iac-tool-terraform.md"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "**/*.py"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "*.zip", "path": ".cache/aws-icons"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "Downloads|\\.ssh|\\.aws", "path": ".claude"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "x", "glob": "*.md"}},
    {"tool_name": "Read", "tool_input": {}},
    {"tool_name": "Glob", "tool_input": {"pattern": "*.zip", "path": "C:\\Users\\user\\projects"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "~/projects/**/*.md"}},
    {"tool_name": "Glob", "tool_input": {"pattern": "**/*.py"}},
    {"tool_name": "Grep", "tool_input": {"pattern": "token", "path": "~/projects/repo"}},
    {"tool_name": "Write", "tool_input": {"file_path": "work/20261030/x.html", "content": "x"}},
    {"tool_name": "Edit", "tool_input": {"file_path": "C:\\Users\\user\\projects\\repo\\CLAUDE.md"}},
]


class FindSensitiveTest(unittest.TestCase):
    def test_保護した場所に触れるコマンドを見つける(self):
        for command in BLOCKED:
            with self.subTest(command=command):
                self.assertIsNotNone(find_in_command(command, HOME, CWD))

    def test_保護した場所に触れないコマンドは通す(self):
        for command in ALLOWED:
            with self.subTest(command=command):
                self.assertIsNone(find_in_command(command, HOME, CWD))

    def test_ファイルを扱うツールで保護した場所を指す入力を見つける(self):
        for payload in TOOL_BLOCKED:
            with self.subTest(payload=payload):
                self.assertIsNotNone(find_sensitive(payload, HOME, CWD))

    def test_ファイルを扱うツールで保護した場所を指さない入力は通す(self):
        for payload in TOOL_ALLOWED:
            with self.subTest(payload=payload):
                self.assertIsNone(find_sensitive(payload, HOME, CWD))

    def test_検出したときは保護した場所の名前を返す(self):
        self.assertEqual(find_in_command("ls ~/.ssh", HOME, CWD), ".ssh")

    def test_保護する場所の一覧は空でない(self):
        self.assertIn("Downloads", PROTECTED)


class HookScriptTest(unittest.TestCase):
    def run_hook(self, payload):
        return subprocess.run(
            ["sh", str(HOOK)], input=json.dumps(payload).encode("utf-8"), capture_output=True
        )

    def test_保護した場所に触れる操作は終了コード2で止め理由を出す(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "ls ~/Downloads"}, "cwd": CWD})
        self.assertEqual(result.returncode, 2)
        self.assertIn("検出", result.stderr.decode("utf-8"))

    def test_ふつうのコマンドは通す(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "git status"}, "cwd": CWD})
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))

    def test_コマンドの無い入力は通す(self):
        self.assertEqual(self.run_hook({"tool_name": "Bash", "tool_input": {}}).returncode, 0)

    def test_検査が例外で落ちたときも終了コード2で止める(self):
        result = self.run_hook({"tool_name": "Bash", "tool_input": "辞書でない入力"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("異常終了", result.stderr.decode("utf-8"))

    def test_壊れたJSONは終了コード2で止める(self):
        result = subprocess.run(["sh", str(HOOK)], input=b"{not json", capture_output=True)
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
