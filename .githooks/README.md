# .githooks — コミット前の検査

git のフック一式。`git config core.hooksPath .githooks` で有効にする（入れ方はルートの [README.md](../README.md#コミット前の検査)）。理由は [docs/adr/0004](../docs/adr/0004-treat-as-public-from-day-one.md)。

Claude Code のフック（`.claude/hooks/`）とは別物で、Claude を使わずにコミットしても動く。

`commit-msg` は引数のファイルを検査するので、Issue の下書きの検査にも使う（`.claude/skills/create-issue`）。gitleaks の設定（独自ルール）はルートの `.gitleaks.toml` に置く。
