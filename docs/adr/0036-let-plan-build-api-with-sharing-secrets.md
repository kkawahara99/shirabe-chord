# 0036. PR の plan で API をビルドし、共有の Secrets を渡す（plan のジョブを緩める）

- **Status**: Active
- **Date**: 2026-11-08

## Context

[0027](0027-ci-cd-with-three-workflows.md) で、PR の plan のジョブは「使ってよいアクションの一覧」で縛り、依存のインストールやビルドは持たせなかった。共有の部品（[0035](0035-share-by-unguessable-url-with-google-login.md)）が `infra/app` に入ると、plan に次の 2 つが要る。

- Lambda に載せる zip は、API のビルド成果物（`apps/api/dist/index.mjs`）から作る。共有の部品があるとき、plan はこのファイルを読むので、plan にもビルドが要る。
- 共有の部品は、Google の 3 つの値が渡されたときだけ作る。plan に渡さないと、公開後のすべての PR の plan が「共有の部品をすべて消す」差分を出し、本物の差分が埋もれる。

## Decision

- `plan.yml` で使ってよいアクションに `pnpm/action-setup` と `actions/setup-node` を足す。`deploy.yml` と同じ SHA 固定のものを使い、固定の決まりは変えない。
- plan のジョブは、依存のインストール（`pnpm install --frozen-lockfile`）と API のビルド（`pnpm --filter api build`）を、AWS の認証情報を取る手順より前に行う。ビルドの環境に認証情報を直接見せない並べ方で、完全な隔離ではない（下の Consequences）。
- Google の 3 つの値（`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`COGNITO_DOMAIN_PREFIX`）は、`terraform plan` のステップの `env:` に `TF_VAR_*` として Secrets から渡す。`-var` では渡さない。未設定でも失敗せず、共有の部品が作られないだけにする。

## Consequences

- PR の plan は、共有の部品の有無によらず、main と同じ前提で差分を出す。
- PR のコードで依存のインストールとビルドが動く。ジョブは `id-token: write` を持つので、ビルドの手順も OIDC のトークンを取れる（[0027](0027-ci-cd-with-three-workflows.md) が deploy について認めたのと同じ）。順序で防げるのは認証情報を環境変数で直接見せないことまでで、守りの本体は、同じリポジトリの PR だけで動く条件（fork を除く）、書き込み権限を持つ人への守りがロールの権限であること（0027）、依存の決まり（[0015](0015-pnpm-workspace-and-dependency-guards.md)）にある。
- Google のクライアントシークレットが、同じリポジトリの PR で書き換えられた `plan.yml` から読める。[0027](0027-ci-cd-with-three-workflows.md) のとおり、書き込み権限を持つ人への守りはワークフローのテストではない。増えるのは、ロールの権限の外にある秘密が 1 つ読める点。Google 側でクライアントシークレットを作り直せば無効にできるので受け入れる。

## Why not

- **plan に Google の値を渡さない**: 差分が常に「共有の部品を消す」になり、PR のレビューで本物の差分を見分けられない。
- **クライアントシークレットだけ渡さず、差分を `ignore_changes` などで抑える**: ID とドメインの接頭辞が渡ると共有の部品は作る側になり、シークレットだけ空だと変数の検証（3 つそろえる）で plan が失敗する。検証を緩めると、apply 側の安全の条件まで弱くなる。
- **ビルド成果物を別のジョブからアーティファクトで渡す**: `upload-artifact` は伏せ字が効かず、使ってよい一覧に危険なアクションを足すことになる。
- **plan から zip の読み取りを外す（共有の部品を数えない）**: plan が apply と違う差分を出すので、plan の意味が薄れる。
- **使ってよい一覧をやめて禁止の一覧に戻す**: 0027 のとおり、新しい書き方が増えたとき抜けが出る。
