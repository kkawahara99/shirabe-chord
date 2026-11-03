# .githooks — コミット前の検査

git のフック一式。`git config core.hooksPath .githooks` で有効にする（入れ方はルートの [README.md](../README.md#コミット前の検査)）。理由は [docs/adr/0004](../docs/adr/0004-treat-as-public-from-day-one.md)。

Claude Code のフック（`.claude/hooks/`）とは別物で、Claude を使わずにコミットしても動く。

`commit-msg` は引数のファイルを検査するので、Issue の下書きの検査にも使う（`.claude/skills/create-issue`）。gitleaks の設定（独自ルール）はルートの `.gitleaks.toml` に置く。

## 防げないもの

- cherry-pick と rebase で作られるコミットは、git がフックを呼ばないので検査されない。
- 禁止語の照合は1行ごとの部分一致。空白や記号で区切った語、行をまたいだ語、ひらがなとカタカナの書き分けは拾わない。
- 画像とフォントは、UTF-8 として読める部分だけを照合する。圧縮・UTF-16 のメタデータは拾わない。それ以外の形式で文字として読めないファイル（PDF・書庫・Office 文書など）は止める。
- 個人情報の形の検出（gitleaks の独自ルール）は代表的な書き方だけ。UNC パスなどは拾わない。
- バケット名の中のアカウントIDは、`-<12桁>-<リージョン>-an` の形だけ拾う。
- `core.hooksPath` は相対パスなので、`.githooks/` が無いブランチや古いコミットでは、フックは何も言わずに動かない。
