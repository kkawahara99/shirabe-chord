# bootstrap

本体の状態ファイル（tfstate）を置く S3 バケットと、GitHub Actions が長期の鍵なしで AWS に入るための OIDC プロバイダ・ロール 2 つを作る、初回だけ手で適用するルートモジュール。自身の状態は手元のローカルに置く（backend を書かない）。`terraform.tfstate` は gitignore 対象だが、消さずに手元に残す。

作るもの:

- 状態ファイル用のバケット1つ。バージョニング・SSE-S3 の暗号化・パブリックアクセスの全ブロック・TLS 以外の拒否・古い版を 90 日で削除（現行の状態ファイルは消えない）・`prevent_destroy` を備える。
- GitHub の OIDC プロバイダ（`create_github_oidc_provider` が `true` のときだけ）。
- `<project_name>-<environment>-iam-deploy`（main 用。信頼は `<github_oidc_sub_prefix>:ref:refs/heads/main` に限る）と `...-iam-plan`（PR 用の読み取り専用。信頼は `<github_oidc_sub_prefix>:pull_request`。書き込めるのは状態ファイルのロック用オブジェクトだけ）。権限の範囲は [ADR 0003](../../docs/adr/0003-account-agnostic.md) とテスト（`tests/roles.tftest.hcl`）が正本。

変数 `github_oidc_sub_prefix` は必須。`gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix` の出力をそのまま書く（形はリポジトリの設定で変わる。[ADR 0029](../../docs/adr/0029-trust-the-actual-github-oidc-subject.md)）。OIDC プロバイダが既にあるアカウント（ランディングゾーンが作った場合など）では、`terraform.tfvars` に `create_github_oidc_provider = false` と書く（同じ URL のプロバイダは 1 アカウントに 1 つしか作れない）。すでにこのモジュールを適用した人は、`terraform.tfvars` の `github_repository` を `github_oidc_sub_prefix` に書き換えてから適用し直す。

バケット名は `<project_name>-<environment>-s3-state-<アカウントID>-<リージョン>-an`。アカウントIDはデプロイ先から引くので渡さない。リージョンは変数 `region` で渡し、名前にはプロバイダの値を使う（[ADR 0005](../../docs/adr/0005-resource-naming.md)）。

## 適用の手順

AWS の認証情報（プロファイルなど）を設定した状態で、このフォルダで行う。git worktree の中では適用しない。worktree を消すと、gitignore 対象の `terraform.tfstate` も一緒に消える。

1. `terraform.tfvars.example` を `terraform.tfvars` にコピーし、値を決める。`project_name` と `environment` は既定のままにする。CI は `infra/app` にこの 2 つを渡さず既定値で動くので、変えるとロールが許すバケット名とずれてデプロイが権限エラーになる。
2. `terraform init`
3. `terraform plan` で内容を確かめる。
4. `terraform apply`
5. `terraform output -raw backend_config_example` の出力を、`infra/app/` の `backend.app.hcl`（gitignore 対象）に写す。バケット名にアカウントIDが入るので、出力は貼らない。
6. GitHub の Secrets に次の 4 つを入れる。値にアカウントIDが入るので、Variables には入れず、出力も貼らない。`AWS_REGION` は変数 `region` と同じ値にする。入れた後は、main への push がデプロイになる。

   ```
   terraform output -raw bucket_name | gh secret set TF_STATE_BUCKET
   terraform output -raw deploy_role_arn | gh secret set AWS_DEPLOY_ROLE_ARN
   terraform output -raw plan_role_arn | gh secret set AWS_PLAN_ROLE_ARN
   gh secret set AWS_REGION --body <region の値>
   ```

`apply` はアカウントに実際にバケットとロールを作るので、本人が承認してから行う。

## テスト

検査コマンドは [CLAUDE.md](../../CLAUDE.md) のテストコマンドを参照。
