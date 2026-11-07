"""GitHub Actions のワークフロー（.github/workflows/）の安全の条件を守るテスト。

YAML は読み込みライブラリを使わず、行と正規表現で読む（標準ライブラリだけで動かすため）。
そのぶん読める書き方を絞り、絞った前提が崩れたら素通りさせずに落とす。

守る理由は docs/adr/0027-ci-cd-with-three-workflows.md。要点は、main の上で動くワークフローは
イベントの種類を問わず OIDC の sub が同じになるため、禁止の一覧ではなく「使ってよいトリガー」の一覧で縛ること。
"""

import re
import tempfile
import unittest
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).resolve().parents[1] / "workflows"

# ファイルごとの決まり。ここに無いファイル名は、検査が追いつかないので落とす
ALLOWED_TRIGGERS = {
    "test.yml": {"pull_request", "workflow_call"},
    "plan.yml": {"pull_request"},
    "deploy.yml": {"push"},
}
ROLE_SECRET = {
    "test.yml": None,
    "plan.yml": "AWS_PLAN_ROLE_ARN",
    "deploy.yml": "AWS_DEPLOY_ROLE_ARN",
}
# AWS に入るジョブ（configure-aws-credentials を使うジョブ）の数
AWS_JOB_COUNT = {"test.yml": 0, "plan.yml": 1, "deploy.yml": 1}

FORK_GUARD = "github.event.pull_request.head.repo.full_name == github.repository"
# plan の出力に、アカウントIDの入ったバケット名が出うる（ADR 0005）。ログ以外へ流す書き方を止める
PLAN_FORBIDDEN_OUTPUTS = ("GITHUB_STEP_SUMMARY", "gh pr comment", "gh pr review", "gh issue comment", "gh api", "github-script")
# plan.yml で使ってよいアクション。禁止の一覧は抜けが出る（upload-artifact は伏せ字が効かない）ので、使ってよい一覧で縛る
PLAN_ALLOWED_ACTIONS = {"actions/checkout", "hashicorp/setup-terraform", "aws-actions/configure-aws-credentials"}

AWS_ACTION = "aws-actions/configure-aws-credentials"


class WorkflowFormatError(Exception):
    """検査が前提にしている YAML の書き方から外れている。"""


# --- 読み取り（行と正規表現） ---------------------------------------------------


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def is_content(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")


def code_lines(text: str) -> list[str]:
    """全行コメントと空行を除く。行末のコメントは残す（式は行末のコメントの中でも展開される）。"""
    return [line for line in text.splitlines() if is_content(line)]


def top_level_block(text: str, key: str) -> tuple[str, list[str]] | None:
    """インデント 0 の `key:` の、行内の値と、続くインデントのある行を返す。無ければ None。"""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(rf"""^["']?{re.escape(key)}["']?:[ \t]*(.*?)\s*$""", line)
        if not m:
            continue
        inline = re.sub(r"\s+#.*$", "", m.group(1))
        block = []
        for follow in lines[i + 1 :]:
            if is_content(follow) and indent_of(follow) == 0:
                break
            block.append(follow)
        return inline, block
    return None


def split_jobs(text: str) -> dict[str, list[str]]:
    """`jobs:` の直下（インデント 2）のキーごとに、そのジョブの行を返す。

    前提が崩れていたら WorkflowFormatError にする（崩れたまま読むと、ジョブを取りこぼして素通りする）。
    """
    found = top_level_block(text, "jobs")
    if found is None:
        raise WorkflowFormatError("jobs: が無い")
    jobs: dict[str, list[str]] = {}
    current: str | None = None
    for line in found[1]:
        if "\t" in line[: len(line) - len(line.lstrip())]:
            raise WorkflowFormatError(f"インデントにタブがある: {line!r}")
        if not is_content(line):
            if current is not None:
                jobs[current].append(line)
            continue
        indent = indent_of(line)
        if indent < 2 or (current is None and indent != 2):
            raise WorkflowFormatError(f"jobs: の直下がインデント 2 でない: {line!r}")
        if indent == 2:
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", line)
            if not m:
                raise WorkflowFormatError(f"jobs: の直下に、ジョブ名のキーでない行がある: {line!r}")
            current = m.group(1)
            jobs[current] = []
        else:
            assert current is not None
            jobs[current].append(line)
    if not jobs:
        raise WorkflowFormatError("jobs: の下にジョブが 1 つも無い")
    return jobs


def parse_triggers(text: str) -> dict[str, list[str]] | None:
    """`on:` のイベント名と、そのイベントの設定の行を返す。`on:` が無ければ None。"""
    found = top_level_block(text, "on")
    if found is None:
        return None
    inline, block = found
    if inline.startswith("{"):
        raise WorkflowFormatError("on: を {...} の形で書いている（ブロックか [...] で書く）")
    if inline.startswith("["):
        names = [n.strip().strip("'\"") for n in inline.strip("[]").split(",") if n.strip()]
        return {n: [] for n in names}
    if inline:
        return {inline.strip("'\""): []}
    events: dict[str, list[str]] = {}
    current: str | None = None
    event_indent: int | None = None
    for line in block:
        if not is_content(line):
            continue
        indent = indent_of(line)
        if event_indent is None:
            event_indent = indent
        if indent == event_indent:
            m = re.match(r"^\s*(?:-\s+)?([A-Za-z0-9_-]+):?\s*(?:#.*)?$", line)
            if not m:
                raise WorkflowFormatError(f"on: の直下を読めない: {line!r}")
            current = m.group(1)
            events[current] = []
        elif current is not None:
            events[current].append(line)
    return events


def branch_filters(body: list[str]) -> dict[str, list[str]]:
    """イベントの設定から、branches・tags・paths とそれぞれの -ignore の値の一覧を返す。"""
    filters: dict[str, list[str]] = {}
    for i, line in enumerate(body):
        m = re.match(r"^\s*(branches|branches-ignore|tags|tags-ignore|paths|paths-ignore):\s*(.*?)\s*$", line)
        if not m:
            continue
        value = re.sub(r"\s+#.*$", "", m.group(2))
        if value.startswith("["):
            items = [x.strip().strip("'\"") for x in value.strip("[]").split(",") if x.strip()]
        elif value:
            items = [value.strip("'\"")]
        else:
            items = []
            for follow in body[i + 1 :]:
                item = re.match(r"^\s*-\s*(.+?)\s*$", follow)
                if not item:
                    break
                items.append(re.sub(r"\s+#.*$", "", item.group(1)).strip("'\""))
        filters[m.group(1)] = items
    return filters


def run_blocks(text: str) -> list[str]:
    """`run:` に書かれたシェルの文字列（1 行でも `|` の複数行でも）を返す。"""
    lines = text.splitlines()
    blocks = []
    for i, line in enumerate(lines):
        m = re.match(r"""^(\s*)(-\s+)?["']?run["']?:[ \t]*(.*)$""", line)
        if not m:
            continue
        key_indent = len(m.group(1)) + (len(m.group(2)) if m.group(2) else 0)
        body = [m.group(3)]
        for follow in lines[i + 1 :]:
            if is_content(follow) and indent_of(follow) <= key_indent:
                break
            body.append(follow)
        blocks.append("\n".join(body))
    return blocks


def steps_using(job_lines: list[str], action: str) -> list[list[str]]:
    """ジョブの中で、指定のアクションを使うステップごとの行を返す。"""
    found = []
    for i, line in enumerate(job_lines):
        if not re.match(rf"^\s*(?:-\s+)?uses:\s*['\"]?{re.escape(action)}@", line, re.IGNORECASE):
            continue
        start = i
        while start > 0 and not re.match(r"^\s*- ", job_lines[start]):
            start -= 1
        dash_indent = indent_of(job_lines[start])
        end = i + 1
        while end < len(job_lines) and not (is_content(job_lines[end]) and indent_of(job_lines[end]) <= dash_indent):
            end += 1
        found.append(job_lines[start:end])
    return found


def aws_jobs(text: str) -> dict[str, list[str]]:
    return {name: lines for name, lines in split_jobs(text).items() if steps_using(lines, AWS_ACTION)}


# --- 検査（YAML の文字列 → 違反の一覧。空なら合格） -------------------------------


def check_job_layout(text: str) -> list[str]:
    try:
        split_jobs(text)
    except WorkflowFormatError as e:
        return [str(e)]
    return []


PERMISSION_LINE = re.compile(r"^\s+([a-z-]+):\s*(read|write|none)\s*(#.*)?$")


def check_permissions(text: str) -> list[str]:
    """最上位の permissions があり、write-all も id-token 以外の write も無い。

    書き方は「行内は read-all か {} だけ、ブロックは `キー: read|write|none` の行だけ」に絞る。
    引用符や {...} の別の書き方は、読み違えて素通りしないよう違反にする。
    """
    if top_level_block(text, "permissions") is None:
        return ["最上位の permissions が無い"]
    violations = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"""^(\s*)["']?permissions["']?:[ \t]*(.*?)\s*$""", line)
        if not m or not is_content(line):
            continue
        top = m.group(1) == ""
        inline = re.sub(r"\s+#.*$", "", m.group(2))
        if inline and inline not in ("read-all", "{}"):
            violations.append(f"permissions の行内の値は read-all か {{}} だけ: {inline}")
        if inline:
            continue
        for follow in lines[i + 1 :]:
            if not is_content(follow):
                continue
            if indent_of(follow) <= len(m.group(1)):
                break
            entry = PERMISSION_LINE.match(follow)
            if not entry:
                violations.append(f"permissions の行を読めない（キーと値を引用符なしで 1 行に書く）: {follow.strip()}")
            elif entry.group(2) == "write" and (top or entry.group(1) != "id-token"):
                where = "最上位の" if top else ""
                violations.append(f"{where}permissions が write 権限を持つ: {entry.group(1)}")
    return list(dict.fromkeys(violations))


def check_triggers(name: str, text: str) -> list[str]:
    if name not in ALLOWED_TRIGGERS:
        return [f"{name}: 使ってよいトリガーの一覧が無いファイル（test_workflows.py に足す）"]
    try:
        events = parse_triggers(text)
    except WorkflowFormatError as e:
        return [str(e)]
    if events is None:
        return ["on: が無い"]
    violations = []
    extra = set(events) - ALLOWED_TRIGGERS[name]
    if extra:
        violations.append(f"許可の一覧にないトリガー: {sorted(extra)}")
    missing = ALLOWED_TRIGGERS[name] - set(events)
    if missing:
        violations.append(f"必要なトリガーが無い: {sorted(missing)}")
    if "push" in events:
        filters = branch_filters(events["push"])
        if filters.get("branches") != ["main"] or set(filters) - {"branches"}:
            violations.append(f"push は branches: [main] だけにする（見つかった絞り込み: {filters}）")
    return violations


def check_roles(name: str, text: str) -> list[str]:
    if name not in ROLE_SECRET:
        return [f"{name}: ロールの決まりが無いファイル"]
    expected = ROLE_SECRET[name]
    code = "\n".join(code_lines(text))
    violations = []
    for line in code.splitlines():
        if "${{" in line and re.search(r"\bsecrets\b(?!\.[A-Za-z0-9_]|\[\s*['\"])", line):
            violations.append(f"secrets を名前で指さずに使っている（toJSON(secrets) など）: {line.strip()}")
    secrets = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", code))
    secrets |= set(re.findall(r"""secrets\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]""", code))
    if expected is None:
        if secrets:
            violations.append(f"AWS に入らないファイルが Secrets を使っている: {sorted(secrets)}")
        return violations
    roles = {s for s in secrets if "ROLE" in s}
    if roles != {expected}:
        violations.append(f"参照してよいロールは {expected} だけ（見つかった: {sorted(roles)}）")
    for line in code_lines(text):
        m = re.match(r"^\s*role-to-assume:\s*(.*?)\s*$", line)
        if m and m.group(1) != "${{ secrets." + expected + " }}":
            violations.append(f"role-to-assume が ${{{{ secrets.{expected} }}}} でない: {m.group(1)}")
    return violations


def check_id_token(name: str, text: str) -> list[str]:
    violations = []
    for job, lines in split_jobs(text).items():
        has_token = any(re.match(r"""^\s*["']?id-token["']?:\s*["']?write\b""", line) for line in code_lines("\n".join(lines)))
        uses_aws = bool(steps_using(lines, AWS_ACTION))
        if has_token and not (uses_aws and ROLE_SECRET.get(name)):
            violations.append(f"ジョブ {job}: AWS に入らないのに id-token: write を持つ")
        if uses_aws and not has_token:
            violations.append(f"ジョブ {job}: AWS に入るのに id-token: write が無い")
    return violations


def check_pinned_uses(text: str) -> list[str]:
    violations = []
    count = 0
    for line in code_lines(text):
        m = re.match(r"^\s*(?:-\s+)?uses:\s*(.*?)\s*$", line)
        if not m:
            continue
        count += 1
        value = re.match(r"""^(['"]?)([^\s'"#]+)\1\s*(#.*)?$""", m.group(1))
        if not value:
            violations.append(f"uses: を読めない: {line.strip()}")
            continue
        target, comment = value.group(2), value.group(3)
        if target.startswith("./"):
            continue
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}", target):
            violations.append(f"40 桁のコミット SHA で固定されていない: {target}")
        elif not (comment and re.match(r"#\s*v\d+(\.\d+)*\s*$", comment)):
            violations.append(f"版のコメント（# v1.2.3）が無い: {target}")
    if count == 0:
        violations.append("uses: が 1 件も無い（読めていない）")
    return violations


def check_plan_output(text: str) -> list[str]:
    """plan.yml 専用: fork の PR を動かさず、plan の出力を PR やサマリーに書かない。"""
    violations = []
    jobs = aws_jobs(text)
    if not jobs:
        return ["AWS に入るジョブが無い"]
    for name, lines in jobs.items():
        # 条件は式の全体が一致するときだけ許す（`true || ...` で素通りさせない）
        job_if = [
            line
            for line in lines
            if (m := re.match(r"^    if:\s*(.*?)\s*$", line))
            and re.sub(r"^\$\{\{\s*|\s*\}\}$", "", re.sub(r"\s+#.*$", "", m.group(1))) == FORK_GUARD
        ]
        if not job_if:
            violations.append(f"ジョブ {name}: fork を除く if（{FORK_GUARD}）が無い")
    code = "\n".join(code_lines(text))
    for word in PLAN_FORBIDDEN_OUTPUTS:
        if word in code:
            violations.append(f"plan の出力をログ以外へ流しうる書き方: {word}")
    for line in code.splitlines():
        used = re.match(r"^\s*(?:-\s+)?uses:\s*['\"]?([^@\s'\"]+)", line)
        if used and used.group(1) not in PLAN_ALLOWED_ACTIONS:
            violations.append(f"plan.yml で使ってよい一覧にないアクション: {used.group(1)}")
    return violations


def check_aws_credentials(name: str, text: str) -> list[str]:
    violations = []
    jobs = aws_jobs(text)
    steps = [step for lines in jobs.values() for step in steps_using(lines, AWS_ACTION)]
    expected = AWS_JOB_COUNT.get(name)
    if expected is None:
        return [f"{name}: AWS の件数の決まりが無いファイル"]
    if len(steps) != expected or len(jobs) != expected:
        violations.append(
            f"configure-aws-credentials のステップは {expected} 件、使うジョブは {expected} つのはず"
            f"（ステップ {len(steps)} 件・ジョブ {len(jobs)} つ）"
        )
    for step in steps:
        if not any(re.match(r"^\s*mask-aws-account-id:\s*true\s*(#.*)?$", line) for line in step):
            violations.append("configure-aws-credentials に mask-aws-account-id: true が無い")
    return violations


def check_secrets_and_expressions(text: str) -> list[str]:
    violations = []
    for line in code_lines(text):
        if re.match(r"^\s*secrets:\s*inherit\b", line):
            violations.append("secrets: inherit を使っている")
        if re.search(r"\$\{\{.*\bvars\b", line):
            violations.append(f"Variables（vars）を使っている: {line.strip()}")
    # run: の中身は、シェルのコメント行も含めて元の文字列から集める（式はシェルのコメントの中でも展開される）。
    # 式の種類は問わず禁じる（github.event・github.head_ref・toJSON(...)・secrets は env: 経由に統一する）
    blocks = run_blocks(text)
    if not blocks:
        violations.append("run: が 1 件も無い（読めていない）")
    for block in blocks:
        if "${{" in block:
            violations.append('run: に ${{ ... }} を埋めている（値は env: で渡し、シェルでは "$X" で参照する）')
    return list(dict.fromkeys(violations))


def unquote(value: str) -> str:
    m = re.fullmatch(r"""(['"])(.*)\1""", value)
    return m.group(2) if m else value


def concurrency_settings(text: str) -> dict[str, str] | None:
    """最上位の concurrency の group と cancel-in-progress の値（引用符を外したもの）。無ければ None。"""
    found = top_level_block(text, "concurrency")
    if found is None:
        return None
    inline, block = found
    if inline:
        raise WorkflowFormatError(f"concurrency: をブロックで書いていない（group と cancel-in-progress を 2 字下げて並べる）: {inline}")
    settings: dict[str, str] = {}
    for line in block:
        if not is_content(line):
            continue
        m = re.match(r"^  (group|cancel-in-progress):[ \t]*(.*?)\s*$", line)
        if not m:
            raise WorkflowFormatError(f"concurrency: の中を読めない: {line!r}")
        settings[m.group(1)] = unquote(re.sub(r"\s+#.*$", "", m.group(2)))
    return settings


def check_concurrency(name: str, text: str) -> list[str]:
    """同時実行の決まり。deploy は止めない。test は固定の true で取り消さず deploy と別 group。plan は取り消さない。

    deploy.yml から呼ばれた test が deploy の group に入って自分を取り消す、
    実行中の apply や plan を途中で止めて状態ファイルのロックを残す、の 2 つを防ぐ。
    """
    try:
        settings = concurrency_settings(text)
    except WorkflowFormatError as e:
        return [str(e)]
    group = settings.get("group") if settings else None
    cancel = settings.get("cancel-in-progress") if settings else None
    violations = []
    if name == "deploy.yml":
        if settings is None:
            return ["concurrency が無い"]
        if group != "deploy":
            violations.append(f"group は deploy のまま（見つかった: {group}）")
        if cancel != "false":
            violations.append(f"cancel-in-progress は false のまま（見つかった: {cancel}）")
    elif name == "test.yml":
        if cancel is not None and re.sub(r"^\$\{\{\s*|\s*\}\}$", "", cancel).lower() == "true":
            violations.append("cancel-in-progress を固定の true にしている（deploy から呼ばれたときも取り消してしまう）")
        if group == "deploy":
            violations.append("group が deploy と同じ（呼び出し元の group に入って自分を取り消す）")
    elif name == "plan.yml":
        if cancel is not None and cancel != "false":
            violations.append(f"cancel-in-progress は false 固定にする（plan は状態ファイルのロックを持つ。見つかった: {cancel}）")
    return violations


def check_plan_paths(text: str) -> list[str]:
    """plan.yml 専用: pull_request の paths に infra/app/** がある（plan は infra/app しか見ない）。"""
    try:
        events = parse_triggers(text)
    except WorkflowFormatError as e:
        return [str(e)]
    if not events or "pull_request" not in events:
        return ["pull_request が無い"]
    if "infra/app/**" not in branch_filters(events["pull_request"]).get("paths", []):
        return ["pull_request の paths に infra/app/** が無い"]
    return []


TERRAFORM_JOB = "terraform"


def split_steps(job_lines: list[str]) -> list[list[str]]:
    """ジョブの `steps:` の下を、ステップごとの行に分ける。"""
    steps: list[list[str]] = []
    dash_indent: int | None = None
    in_steps = False
    for line in job_lines:
        if not is_content(line):
            if steps:
                steps[-1].append(line)
            continue
        if re.match(r"^    steps:\s*(#.*)?$", line):
            in_steps = True
        elif in_steps and indent_of(line) <= 4:
            in_steps = False
        elif in_steps and re.match(r"^\s*- ", line) and dash_indent in (None, indent_of(line)):
            dash_indent = indent_of(line)
            steps.append([line])
        elif in_steps and steps:
            steps[-1].append(line)
    return steps


def check_terraform_judge(text: str) -> list[str]:
    """test.yml 専用: terraform ジョブも、変更の判定ステップも、if で飛ばさない。

    飛ばすと、main への push（deploy 経由）で Terraform の検査が黙って抜ける。
    判定ステップは、ほかのステップの if が steps.<id>.outputs で参照している id のステップ。
    """
    lines = split_jobs(text).get(TERRAFORM_JOB)
    if lines is None:
        return [f"ジョブ {TERRAFORM_JOB} が無い"]
    violations = []
    if any(re.match(r"^    if:", line) for line in lines):
        violations.append(f"ジョブ {TERRAFORM_JOB} に if がある（飛ばすのは手順の if だけにする）")
    referenced = set(re.findall(r"steps\.([A-Za-z0-9_-]+)\.outputs", "\n".join(code_lines("\n".join(lines)))))
    judges = 0
    for step in split_steps(lines):
        ids = {m.group(1) for line in step if (m := re.match(r"""^\s*(?:-\s+)?id:\s*["']?([A-Za-z0-9_-]+)""", line))}
        if not ids & referenced:
            continue
        judges += 1
        key_indent = indent_of(step[0]) + 2
        if re.match(r"^\s*-\s+if:", step[0]) or any(re.match(rf"^ {{{key_indent}}}if:", line) for line in step[1:]):
            violations.append("判定のステップに if がある（main で Terraform の検査が黙って飛ぶ）")
    if not judges:
        violations.append("判定のステップが無い（steps.<id>.outputs を参照するステップの id を持つもの）")
    return violations


def check_workflow_set(names: set[str]) -> list[str]:
    if names != set(ALLOWED_TRIGGERS):
        return [f"ワークフローは {sorted(ALLOWED_TRIGGERS)} の 3 本ちょうど（見つかった: {sorted(names)}）"]
    return []


def check_workflow(name: str, text: str) -> list[str]:
    """1 つのワークフローへの全検査（実ファイル用。落ちた検査の名前が分かるようにする）。"""
    results = {
        "job_layout": check_job_layout(text),
        "permissions": check_permissions(text),
        "triggers": check_triggers(name, text),
        "roles": check_roles(name, text),
        "pinned_uses": check_pinned_uses(text),
        "aws_credentials": check_aws_credentials(name, text),
        "secrets_and_expressions": check_secrets_and_expressions(text),
    }
    if not results["job_layout"]:
        results["id_token"] = check_id_token(name, text)
        results["concurrency"] = check_concurrency(name, text)
    if name == "plan.yml":
        results["plan_output"] = check_plan_output(text)
        results["plan_paths"] = check_plan_paths(text)
    if name == "test.yml" and not results["job_layout"]:
        results["terraform_judge"] = check_terraform_judge(text)
    return [f"[{kind}] {v}" for kind, vs in results.items() for v in vs]


def load_workflows(directory: Path) -> dict[str, str]:
    return {p.name: p.read_text(encoding="utf-8") for p in sorted([*directory.glob("*.yml"), *directory.glob("*.yaml")])}


# --- 実ファイルへの検査 ----------------------------------------------------------


class RealWorkflowsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflows = load_workflows(WORKFLOWS_DIR)

    def assert_all(self, check):
        for name, text in self.workflows.items():
            with self.subTest(workflow=name):
                self.assertEqual(check(name, text), [])

    def test_ワークフローは3本ちょうどある(self):
        self.assertEqual(check_workflow_set(set(self.workflows)), [])

    def test_ジョブの境界の前提が守られている(self):
        self.assert_all(lambda _n, t: check_job_layout(t))

    def test_全ワークフローに最上位のpermissionsがありwrite権限を持たない(self):
        self.assert_all(lambda _n, t: check_permissions(t))

    def test_トリガーは許可の一覧に収まる(self):
        self.assert_all(check_triggers)

    def test_参照するロールのSecretsはファイルごとに決まった1つだけ(self):
        self.assert_all(check_roles)

    def test_id_token_writeはAWSに入るジョブだけが持つ(self):
        self.assert_all(check_id_token)

    def test_usesは40桁のSHAで固定され版コメントが付く(self):
        self.assert_all(lambda _n, t: check_pinned_uses(t))

    def test_planは同じリポジトリのPRだけで動きPRやサマリーに書き込まない(self):
        self.assertEqual(check_plan_output(self.workflows["plan.yml"]), [])

    def test_AWSの認証情報の取得は全てアカウントIDを伏せ件数が決まっている(self):
        self.assert_all(check_aws_credentials)

    def test_secrets_inheritとvarsを使わずrunにgithub_eventとsecretsを埋めない(self):
        self.assert_all(lambda _n, t: check_secrets_and_expressions(t))

    def test_AWSに入るジョブはplanとdeployに各1つ(self):
        for name in ("plan.yml", "deploy.yml"):
            with self.subTest(workflow=name):
                self.assertEqual(len(aws_jobs(self.workflows[name])), 1)

    def test_deployのconcurrencyはgroupがdeployで途中で止めない(self):
        self.assertEqual(check_concurrency("deploy.yml", self.workflows["deploy.yml"]), [])

    def test_testの同時実行は固定のtrueで取り消さずdeployと別groupになる(self):
        self.assertEqual(check_concurrency("test.yml", self.workflows["test.yml"]), [])

    def test_planは途中で取り消さずpathsにinfra_appを含む(self):
        self.assertEqual(check_concurrency("plan.yml", self.workflows["plan.yml"]), [])
        self.assertEqual(check_plan_paths(self.workflows["plan.yml"]), [])

    def test_testのterraformジョブの判定ステップにifが付いていない(self):
        self.assertEqual(check_terraform_judge(self.workflows["test.yml"]), [])


# --- 各検査の異常系（条件を破る YAML を渡すと落ちる） ------------------------------

SHA_A = "a" * 40
SHA_B = "b" * 40

GOOD_PLAN = f"""\
name: plan
on:
  pull_request:
    paths: [infra/app/**, .github/workflows/plan.yml]
concurrency:
  group: plan-${{{{ github.event.pull_request.number }}}}
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  plan:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@{SHA_A} # v7.0.1
      - uses: aws-actions/configure-aws-credentials@{SHA_B} # v6.3.0
        with:
          role-to-assume: ${{{{ secrets.AWS_PLAN_ROLE_ARN }}}}
          aws-region: ${{{{ secrets.AWS_REGION }}}}
          mask-aws-account-id: true
      - name: plan
        env:
          TF_STATE_BUCKET: ${{{{ secrets.TF_STATE_BUCKET }}}}
        run: |
          terraform init -backend-config="bucket=$TF_STATE_BUCKET"
          terraform plan -no-color
"""

GOOD_DEPLOY = f"""\
name: deploy
on:
  push:
    branches: [main]
concurrency:
  group: deploy
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  test:
    uses: ./.github/workflows/test.yml
  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@{SHA_A} # v7.0.1
      - uses: aws-actions/configure-aws-credentials@{SHA_B} # v6.3.0
        with:
          role-to-assume: ${{{{ secrets.AWS_DEPLOY_ROLE_ARN }}}}
          aws-region: ${{{{ secrets.AWS_REGION }}}}
          mask-aws-account-id: true
      - run: terraform apply -auto-approve
"""

GOOD_TEST = f"""\
name: test
on:
  pull_request:
  workflow_call:
concurrency:
  group: test-${{{{ github.event.pull_request.number || github.run_id }}}}
  cancel-in-progress: ${{{{ github.event_name == 'pull_request' }}}}
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@{SHA_A} # v7.0.1
      - run: pnpm test
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@{SHA_A} # v7.0.1
        with:
          fetch-depth: 2
      - id: changed
        env:
          EVENT_NAME: ${{{{ github.event_name }}}}
        run: echo "run=true" >> "$GITHUB_OUTPUT"
      - if: steps.changed.outputs.run == 'true'
        run: terraform validate
"""


def mutate(text: str, old: str, new: str) -> str:
    assert old in text, f"差し替え元が見つからない: {old!r}"
    return text.replace(old, new, 1)


class FixturesTest(unittest.TestCase):
    """異常系の元にする正常な YAML が、検査を通ること（通らないと異常系が意味を失う）。"""

    def test_正常なYAMLは全検査を通る(self):
        for name, text in {"plan.yml": GOOD_PLAN, "deploy.yml": GOOD_DEPLOY, "test.yml": GOOD_TEST}.items():
            with self.subTest(workflow=name):
                self.assertEqual(check_workflow(name, text), [])


class PermissionsTest(unittest.TestCase):
    def test_最上位のpermissionsが無ければ検出する(self):
        text = mutate(GOOD_TEST, "permissions:\n  contents: read\n", "")
        self.assertIn("最上位の permissions が無い", check_permissions(text))

    def test_ジョブ側にだけpermissionsがあっても検出する(self):
        text = mutate(GOOD_TEST, "permissions:\n  contents: read\njobs:", "jobs:")
        text = mutate(text, "    runs-on:", "    permissions:\n      contents: read\n    runs-on:")
        self.assertIn("最上位の permissions が無い", check_permissions(text))

    def test_write_allは最上位でもジョブ側でも検出する(self):
        top = mutate(GOOD_TEST, "permissions:\n  contents: read", "permissions: write-all")
        self.assertTrue(check_permissions(top))
        job = mutate(GOOD_TEST, "    runs-on:", "    permissions: write-all\n    runs-on:")
        self.assertTrue(check_permissions(job))

    def test_最上位のwrite権限は検出する(self):
        text = mutate(GOOD_TEST, "contents: read", "contents: write")
        self.assertTrue(check_permissions(text))

    def test_id_token以外のwrite権限は検出する(self):
        text = mutate(GOOD_PLAN, "      id-token: write", "      id-token: write\n      pull-requests: write")
        self.assertTrue(check_permissions(text))

    def test_引用符や波括弧の別の書き方は素通りしない(self):
        job_write_all = mutate(GOOD_TEST, "    runs-on:", "    permissions: 'write-all'\n    runs-on:")
        self.assertTrue(check_permissions(job_write_all))
        flow = mutate(GOOD_TEST, "    runs-on:", "    permissions: { contents: write, pull-requests: write }\n    runs-on:")
        self.assertTrue(check_permissions(flow))
        flow_token = mutate(GOOD_TEST, "    runs-on:", "    permissions: {id-token: write}\n    runs-on:")
        self.assertTrue(check_permissions(flow_token))
        quoted_value = mutate(GOOD_PLAN, "      id-token: write", "      id-token: 'write'")
        self.assertTrue(check_permissions(quoted_value))
        quoted_key = mutate(GOOD_PLAN, "      id-token: write", '      "id-token": write')
        self.assertTrue(check_permissions(quoted_key))

    def test_空のYAMLは素通りしない(self):
        self.assertTrue(check_permissions(""))


class TriggersTest(unittest.TestCase):
    def test_許可外のトリガーは検出する(self):
        for event in ("issues", "pull_request_target", "workflow_run", "workflow_dispatch", "fork", "schedule"):
            with self.subTest(event=event):
                text = mutate(GOOD_PLAN, "  pull_request:\n", f"  pull_request:\n  {event}:\n")
                self.assertTrue(check_triggers("plan.yml", text))

    def test_testにpushが付いたら検出する(self):
        self.assertTrue(check_triggers("test.yml", mutate(GOOD_TEST, "  workflow_call:", "  workflow_call:\n  push:")))
        self.assertTrue(check_triggers("test.yml", mutate(GOOD_TEST, "on:\n  pull_request:\n  workflow_call:", "on: [pull_request, workflow_call, push]")))

    def test_インライン形の許可外トリガーも検出する(self):
        self.assertTrue(check_triggers("plan.yml", mutate(GOOD_PLAN, "on:\n  pull_request:", "on: [pull_request_target]")))
        self.assertTrue(check_triggers("plan.yml", mutate(GOOD_PLAN, "on:\n  pull_request:", "on: workflow_dispatch")))

    def test_main以外のpushや絞り込みの無いpushは検出する(self):
        for branches in ("branches: [main, dev]", "branches: ['**']", "branches-ignore: [dev]", "tags: ['v*']", ""):
            with self.subTest(branches=branches):
                text = mutate(GOOD_DEPLOY, "    branches: [main]\n", f"    {branches}\n" if branches else "")
                self.assertTrue(check_triggers("deploy.yml", text))
        self.assertTrue(check_triggers("deploy.yml", mutate(GOOD_DEPLOY, "on:\n  push:\n    branches: [main]", "on: push")))

    def test_mainのpushは上の行ごとの書き方でも許す(self):
        text = mutate(GOOD_DEPLOY, "    branches: [main]", "    branches:\n      - main")
        self.assertEqual(check_triggers("deploy.yml", text), [])

    def test_必要なトリガーが無ければ検出する(self):
        self.assertTrue(check_triggers("test.yml", mutate(GOOD_TEST, "  workflow_call:\n", "")))

    def test_波括弧の書き方とonの欠落は素通りしない(self):
        self.assertTrue(check_triggers("plan.yml", mutate(GOOD_PLAN, "on:\n  pull_request:", "on: {pull_request: {}}")))
        self.assertTrue(check_triggers("plan.yml", ""))

    def test_一覧に無いファイル名は検出する(self):
        self.assertTrue(check_triggers("extra.yml", GOOD_PLAN))


class RolesTest(unittest.TestCase):
    def test_planがdeployのロールを参照したら検出する(self):
        self.assertTrue(check_roles("plan.yml", GOOD_PLAN.replace("AWS_PLAN_ROLE_ARN", "AWS_DEPLOY_ROLE_ARN")))

    def test_deployがplanのロールを参照したら検出する(self):
        self.assertTrue(check_roles("deploy.yml", GOOD_DEPLOY.replace("AWS_DEPLOY_ROLE_ARN", "AWS_PLAN_ROLE_ARN")))

    def test_ロールを2つ参照したら検出する(self):
        text = mutate(GOOD_PLAN, "          aws-region:", "          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}\n          aws-region:")
        self.assertTrue(check_roles("plan.yml", text))

    def test_角括弧の書き方やARNの直書きも検出する(self):
        bracket = mutate(GOOD_PLAN, "secrets.AWS_PLAN_ROLE_ARN", "secrets['AWS_DEPLOY_ROLE_ARN']")
        self.assertTrue(check_roles("plan.yml", bracket))
        literal = mutate(GOOD_PLAN, "${{ secrets.AWS_PLAN_ROLE_ARN }}", "arn:aws:iam::123456789012:role/x")
        self.assertTrue(check_roles("plan.yml", literal))

    def test_testがSecretsを使ったら検出する(self):
        text = mutate(GOOD_TEST, "      - run: pnpm test", "      - run: pnpm test\n        env:\n          X: ${{ secrets.TF_STATE_BUCKET }}")
        self.assertTrue(check_roles("test.yml", text))

    def test_Secretsを丸ごと渡す書き方は検出する(self):
        text = mutate(GOOD_TEST, "      - run: pnpm test", "      - run: pnpm test\n        env:\n          X: ${{ toJSON(secrets) }}")
        self.assertTrue(check_roles("test.yml", text))
        text = mutate(GOOD_PLAN, "          aws-region:", "          audience: ${{ toJSON(secrets) }}\n          aws-region:")
        self.assertTrue(check_roles("plan.yml", text))

    def test_ロールを参照しない空のYAMLは素通りしない(self):
        self.assertTrue(check_roles("plan.yml", ""))
        self.assertTrue(check_roles("deploy.yml", ""))


class IdTokenTest(unittest.TestCase):
    def test_無関係なジョブのid_token_writeは検出する(self):
        text = GOOD_DEPLOY + "  other:\n    permissions:\n      id-token: write\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n"
        self.assertTrue(check_id_token("deploy.yml", text))

    def test_testのid_token_writeは検出する(self):
        text = mutate(GOOD_TEST, "    runs-on:", "    permissions:\n      id-token: write\n    runs-on:")
        self.assertTrue(check_id_token("test.yml", text))

    def test_AWSに入るのにid_token_writeが無いジョブも検出する(self):
        self.assertTrue(check_id_token("plan.yml", mutate(GOOD_PLAN, "      id-token: write\n", "")))

    def test_引用符で囲んだid_tokenも検出する(self):
        text = mutate(GOOD_TEST, "    runs-on:", "    permissions:\n      \"id-token\": write\n    runs-on:")
        self.assertTrue(check_id_token("test.yml", text))

    def test_ジョブの境界が崩れていたら落ちる(self):
        with self.assertRaises(WorkflowFormatError):
            check_id_token("plan.yml", mutate(GOOD_PLAN, "\n  plan:\n", "\n    plan:\n"))


class PinnedUsesTest(unittest.TestCase):
    def test_タグ固定は検出する(self):
        self.assertTrue(check_pinned_uses(mutate(GOOD_TEST, f"actions/checkout@{SHA_A} # v7.0.1", "actions/checkout@v7")))

    def test_短いSHAや大文字のSHAは検出する(self):
        self.assertTrue(check_pinned_uses(mutate(GOOD_TEST, SHA_A, "a" * 7)))
        self.assertTrue(check_pinned_uses(mutate(GOOD_TEST, SHA_A, "A" * 40)))

    def test_版のコメントが無ければ検出する(self):
        self.assertTrue(check_pinned_uses(mutate(GOOD_TEST, " # v7.0.1", "")))

    def test_ローカルのワークフローは許す(self):
        self.assertEqual(check_pinned_uses(GOOD_DEPLOY), [])

    def test_dockerやuses行の書き損じは検出する(self):
        self.assertTrue(check_pinned_uses(mutate(GOOD_TEST, f"actions/checkout@{SHA_A} # v7.0.1", "docker://alpine:3")))

    def test_usesが無い空のYAMLは素通りしない(self):
        self.assertTrue(check_pinned_uses(""))


class PlanOutputTest(unittest.TestCase):
    def test_fork除外のifが無ければ検出する(self):
        self.assertTrue(check_plan_output(mutate(GOOD_PLAN, f"    if: {FORK_GUARD}\n", "")))

    def test_forkの条件を逆にしたら検出する(self):
        self.assertTrue(check_plan_output(mutate(GOOD_PLAN, "head.repo.full_name == ", "head.repo.full_name != ")))

    def test_ステップのifに書いても検出する(self):
        text = mutate(GOOD_PLAN, f"    if: {FORK_GUARD}\n", "")
        text = mutate(text, "      - name: plan\n", f"      - name: plan\n        if: {FORK_GUARD}\n")
        self.assertTrue(check_plan_output(text))

    def test_サマリーやPRコメントへの書き込みは検出する(self):
        for line in (
            "terraform plan >> $GITHUB_STEP_SUMMARY",
            "gh pr comment 1 --body x",
            "uses: actions/github-script@v7",
        ):
            with self.subTest(line=line):
                self.assertTrue(check_plan_output(mutate(GOOD_PLAN, "          terraform plan -no-color", f"          {line}")))

    def test_条件の一部にforkの式を含むだけのifは検出する(self):
        self.assertTrue(check_plan_output(mutate(GOOD_PLAN, f"    if: {FORK_GUARD}", f"    if: true || {FORK_GUARD}")))

    def test_式を波括弧で囲んだifは許す(self):
        self.assertEqual(check_plan_output(mutate(GOOD_PLAN, f"    if: {FORK_GUARD}", f"    if: ${{{{ {FORK_GUARD} }}}}")), [])

    def test_ログ以外へ出せるアクションや書き方は一覧に無いので検出する(self):
        upload = mutate(GOOD_PLAN, "      - name: plan\n", f"      - uses: actions/upload-artifact@{SHA_A} # v4.0.0\n      - name: plan\n")
        self.assertTrue(check_plan_output(upload))
        api = mutate(GOOD_PLAN, "          terraform plan -no-color", "          gh api repos/x/issues/1/comments -f body=x")
        self.assertTrue(check_plan_output(api))

    def test_コメント行の言及は許す(self):
        text = mutate(GOOD_PLAN, "name: plan\n", "name: plan\n# GITHUB_STEP_SUMMARY には書かない\n")
        self.assertEqual(check_plan_output(text), [])

    def test_AWSに入るジョブが無いYAMLは素通りしない(self):
        self.assertTrue(check_plan_output(GOOD_TEST))
        with self.assertRaises(WorkflowFormatError):
            check_plan_output("")


class AwsCredentialsTest(unittest.TestCase):
    def test_maskが無ければ検出する(self):
        self.assertTrue(check_aws_credentials("plan.yml", mutate(GOOD_PLAN, "          mask-aws-account-id: true\n", "")))

    def test_maskがfalseなら検出する(self):
        self.assertTrue(check_aws_credentials("plan.yml", mutate(GOOD_PLAN, "mask-aws-account-id: true", "mask-aws-account-id: false")))

    def test_件数が多すぎても足りなくても検出する(self):
        self.assertTrue(check_aws_credentials("plan.yml", mutate(GOOD_PLAN, "      - uses: aws-actions", f"      - uses: aws-actions/configure-aws-credentials@{SHA_B} # v6.3.0\n        with:\n          mask-aws-account-id: true\n      - uses: aws-actions")))
        self.assertTrue(check_aws_credentials("deploy.yml", GOOD_TEST))
        self.assertTrue(check_aws_credentials("test.yml", GOOD_PLAN))

    def test_アクション名の大文字小文字を変えた2つ目も数える(self):
        text = mutate(GOOD_PLAN, "      - name: plan\n", f"      - uses: AWS-Actions/Configure-AWS-Credentials@{SHA_B} # v6.3.0\n      - name: plan\n")
        self.assertTrue(check_aws_credentials("plan.yml", text))

    def test_別のジョブに2つ目があっても検出する(self):
        second = "  second:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: aws-actions/configure-aws-credentials@" + SHA_B + " # v6.3.0\n        with:\n          mask-aws-account-id: true\n"
        self.assertTrue(check_aws_credentials("deploy.yml", GOOD_DEPLOY + second))

    def test_空のYAMLは素通りしない(self):
        with self.assertRaises(WorkflowFormatError):
            check_aws_credentials("plan.yml", "")


class SecretsAndExpressionsTest(unittest.TestCase):
    def test_secrets_inheritは検出する(self):
        self.assertTrue(check_secrets_and_expressions(mutate(GOOD_DEPLOY, "    uses: ./.github/workflows/test.yml", "    uses: ./.github/workflows/test.yml\n    secrets: inherit")))

    def test_varsは検出する(self):
        self.assertTrue(check_secrets_and_expressions(mutate(GOOD_PLAN, "${{ secrets.AWS_REGION }}", "${{ vars.AWS_REGION }}")))

    def test_runの中のSecretsは1行でも複数行でも検出する(self):
        multi = mutate(GOOD_PLAN, "          terraform plan -no-color", '          echo "${{ secrets.TF_STATE_BUCKET }}"')
        self.assertTrue(check_secrets_and_expressions(multi))
        single = mutate(GOOD_DEPLOY, "- run: terraform apply -auto-approve", '- run: echo "${{ secrets.AWS_REGION }}"')
        self.assertTrue(check_secrets_and_expressions(single))

    def test_runの中のgithub_eventは検出する(self):
        text = mutate(GOOD_PLAN, "          terraform plan -no-color", '          echo "${{ github.event.pull_request.title }}"')
        self.assertTrue(check_secrets_and_expressions(text))

    def test_runのシェルのコメント行に隠した式も検出する(self):
        text = mutate(GOOD_PLAN, "          terraform plan -no-color", "          # ${{ github.event.pull_request.body }}\n          terraform plan -no-color")
        self.assertTrue(check_secrets_and_expressions(text))

    def test_関数や角括弧や引用符で囲んだキーの別の書き方も検出する(self):
        for expr in (
            "${{ toJSON(github.event) }}",
            "${{ github['event'].pull_request.title }}",
            "${{ format('{0}', github.event.x) }}",
            "${{ github.head_ref }}",
            "${{ toJSON(vars) }}",
        ):
            with self.subTest(expr=expr):
                text = mutate(GOOD_PLAN, "          terraform plan -no-color", f"          echo {expr}")
                self.assertTrue(check_secrets_and_expressions(text))
        quoted = mutate(GOOD_DEPLOY, "- run: terraform apply -auto-approve", '- "run": echo "${{ github.event.x }}"')
        self.assertTrue(check_secrets_and_expressions(quoted))

    def test_runが1件も無ければ検出する(self):
        self.assertTrue(check_secrets_and_expressions(""))
        self.assertTrue(check_secrets_and_expressions(GOOD_TEST.replace("run: ", "name: ")))

    def test_行末のコメントに隠した式も検出する(self):
        text = mutate(GOOD_DEPLOY, "- run: terraform apply -auto-approve", "- run: echo ok # ${{ secrets.AWS_REGION }}")
        self.assertTrue(check_secrets_and_expressions(text))

    def test_envの中のSecretsやifの中のgithub_eventは許す(self):
        self.assertEqual(check_secrets_and_expressions(GOOD_PLAN), [])


DEPLOY_CONCURRENCY = "concurrency:\n  group: deploy\n  cancel-in-progress: false\n"
TEST_CANCEL = "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
TEST_GROUP = "group: test-${{ github.event.pull_request.number || github.run_id }}"
PLAN_CONCURRENCY = "concurrency:\n  group: plan-${{ github.event.pull_request.number }}\n  cancel-in-progress: false\n"
PLAN_PATHS = "    paths: [infra/app/**, .github/workflows/plan.yml]\n"


class ConcurrencyTest(unittest.TestCase):
    def test_deployのconcurrencyが無い_途中で止める_groupが別名_読めない書き方は検出する(self):
        self.assertTrue(check_concurrency("deploy.yml", mutate(GOOD_DEPLOY, DEPLOY_CONCURRENCY, "")))
        self.assertTrue(check_concurrency("deploy.yml", mutate(GOOD_DEPLOY, "cancel-in-progress: false", "cancel-in-progress: true")))
        self.assertTrue(check_concurrency("deploy.yml", mutate(GOOD_DEPLOY, "group: deploy", "group: deploy-${{ github.run_id }}")))
        self.assertTrue(check_concurrency("deploy.yml", mutate(GOOD_DEPLOY, DEPLOY_CONCURRENCY, "concurrency: deploy\n")))
        self.assertTrue(check_concurrency("deploy.yml", mutate(GOOD_DEPLOY, DEPLOY_CONCURRENCY, "concurrency: { group: deploy }\n")))

    def test_testのcancel_in_progressが固定のtrueなら検出する(self):
        for value in ("true", '"true"', "'true'", "True", "TRUE", "${{ true }}"):
            with self.subTest(value=value):
                self.assertTrue(check_concurrency("test.yml", mutate(GOOD_TEST, TEST_CANCEL, f"cancel-in-progress: {value}")))

    def test_testのgroupがdeployと同じなら検出する(self):
        for value in ("deploy", '"deploy"', "'deploy'"):
            with self.subTest(value=value):
                self.assertTrue(check_concurrency("test.yml", mutate(GOOD_TEST, TEST_GROUP, f"group: {value}")))

    def test_testはPRのときだけ取り消す式を許しconcurrencyが無くても許す(self):
        self.assertEqual(check_concurrency("test.yml", GOOD_TEST), [])
        block = f"concurrency:\n  {TEST_GROUP}\n  {TEST_CANCEL}\n"
        self.assertEqual(check_concurrency("test.yml", mutate(GOOD_TEST, block, "")), [])

    def test_planのcancel_in_progressがfalse固定でなければ検出する(self):
        for value in ("true", "True", "${{ true }}", "${{ github.event_name == 'pull_request' }}"):
            with self.subTest(value=value):
                self.assertTrue(check_concurrency("plan.yml", mutate(GOOD_PLAN, "cancel-in-progress: false", f"cancel-in-progress: {value}")))

    def test_planはconcurrencyが無くても許す(self):
        self.assertEqual(check_concurrency("plan.yml", mutate(GOOD_PLAN, PLAN_CONCURRENCY, "")), [])


class PlanPathsTest(unittest.TestCase):
    def test_pathsにinfra_appが無ければ検出する(self):
        self.assertTrue(check_plan_paths(mutate(GOOD_PLAN, "infra/app/**, ", "")))
        self.assertTrue(check_plan_paths(mutate(GOOD_PLAN, "infra/app/**", "infra/**")))

    def test_pathsが無ければ検出する(self):
        self.assertTrue(check_plan_paths(mutate(GOOD_PLAN, PLAN_PATHS, "")))

    def test_paths_ignoreだけなら検出する(self):
        self.assertTrue(check_plan_paths(mutate(GOOD_PLAN, "    paths: [infra/app/**, .github/workflows/plan.yml]", "    paths-ignore: [infra/app/**]")))

    def test_行ごとのリスト形式も読める(self):
        text = mutate(GOOD_PLAN, PLAN_PATHS, "    paths:\n      - infra/app/**\n      - .github/workflows/plan.yml\n")
        self.assertEqual(check_plan_paths(text), [])

    def test_pushにpathsが付いたら許可外として検出する(self):
        self.assertTrue(check_triggers("deploy.yml", mutate(GOOD_DEPLOY, "    branches: [main]\n", "    branches: [main]\n    paths: [infra/**]\n")))


class TerraformJudgeTest(unittest.TestCase):
    def test_判定ステップに行頭のifが付いたら検出する(self):
        text = mutate(GOOD_TEST, "      - id: changed\n", "      - id: changed\n        if: github.event_name == 'pull_request'\n")
        self.assertTrue(check_terraform_judge(text))

    def test_判定ステップの先頭にifを書いても検出する(self):
        text = mutate(GOOD_TEST, "      - id: changed\n", "      - if: github.event_name == 'pull_request'\n        id: changed\n")
        self.assertTrue(check_terraform_judge(text))

    def test_terraformジョブ全体にifが付いたら検出する(self):
        text = mutate(GOOD_TEST, "  terraform:\n", "  terraform:\n    if: github.event_name == 'push'\n")
        self.assertTrue(check_terraform_judge(text))

    def test_terraformジョブか判定ステップが無ければ検出する(self):
        self.assertTrue(check_terraform_judge(mutate(GOOD_TEST, "  terraform:\n", "  other:\n")))
        self.assertTrue(check_terraform_judge(mutate(GOOD_TEST, "steps.changed.outputs", "steps.other.outputs")))

    def test_正常なものは通る(self):
        self.assertEqual(check_terraform_judge(GOOD_TEST), [])


class JobLayoutTest(unittest.TestCase):
    def test_インデント4のジョブは検出する(self):
        text = mutate(GOOD_TEST, "jobs:\n  test:", "jobs:\n    test:")
        self.assertTrue(check_job_layout(text))

    def test_タブのインデントは検出する(self):
        self.assertTrue(check_job_layout(mutate(GOOD_TEST, "jobs:\n  test:", "jobs:\n\ttest:")))

    def test_ジョブ名でない行が直下にあれば検出する(self):
        self.assertTrue(check_job_layout(mutate(GOOD_TEST, "jobs:\n  test:", "jobs:\n  - test:")))

    def test_jobsが無いかジョブが空なら検出する(self):
        self.assertTrue(check_job_layout("name: x\n"))
        self.assertTrue(check_job_layout("name: x\njobs:\n"))

    def test_正常なものは通る(self):
        self.assertEqual(check_job_layout(GOOD_PLAN), [])


class WorkflowSetTest(unittest.TestCase):
    def test_ワークフローが無ければ検出する(self):
        self.assertTrue(check_workflow_set(set()))
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(check_workflow_set(set(load_workflows(Path(d)))))

    def test_1本足りなくても1本多くても検出する(self):
        self.assertTrue(check_workflow_set({"test.yml", "plan.yml"}))
        self.assertTrue(check_workflow_set({"test.yml", "plan.yml", "deploy.yml", "extra.yml"}))

    def test_yaml拡張子のファイルも読んで検出する(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("test.yml", "plan.yml", "deploy.yml", "extra.yaml"):
                (Path(d) / name).write_text("name: x\n", encoding="utf-8")
            self.assertTrue(check_workflow_set(set(load_workflows(Path(d)))))


if __name__ == "__main__":
    unittest.main()
