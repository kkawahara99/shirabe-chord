# bootstrap

本体の状態ファイル（tfstate）を置く S3 バケットと、GitHub Actions が長期の鍵なしで AWS に入るための OIDC プロバイダ・ロール 2 つ、共有の API（Lambda）の実行ロール、費用のアラートの予算を作る、初回だけ手で適用するルートモジュール。自身の状態は手元のローカルに置く（backend を書かない）。`terraform.tfstate` は gitignore 対象だが、消さずに手元に残す。

作るもの:

- 状態ファイル用のバケット1つ。バージョニング・SSE-S3 の暗号化・パブリックアクセスの全ブロック・TLS 以外の拒否・古い版を 90 日で削除（現行の状態ファイルは消えない）・`prevent_destroy` を備える。
- GitHub の OIDC プロバイダ（`create_github_oidc_provider` が `true` のときだけ）。
- `<project_name>-<environment>-iam-deploy`（main 用。信頼は `<github_oidc_sub_prefix>:ref:refs/heads/main` に限る）と `...-iam-plan`（PR 用の読み取り専用。信頼は `<github_oidc_sub_prefix>:pull_request`。書き込めるのは状態ファイルのロック用オブジェクトだけ）。権限の範囲は [ADR 0003](../../docs/adr/0003-account-agnostic.md) とテスト（`tests/roles.tftest.hcl`）が正本。
- `<project_name>-<environment>-iam-lambda-api`（共有の API の Lambda の実行ロール。DynamoDB のテーブルと索引、ロググループへの書き込み、SSM の Turnstile の秘密鍵の読み取りだけを、固定の名前で許す。Google の設定にかかわらず作る。[ADR 0035](../../docs/adr/0035-share-by-unguessable-url-with-google-login.md)）。SSM のパラメータは既定の鍵（`aws/ssm`）の SecureString で作る。カスタマー管理の鍵だと、実行ロールに `kms:Decrypt` が無く読めない。
- `<project_name>-<environment>-budgets-monthly`（アカウント全体の月の費用が予算の 80% と 100% を超えたらメールで知らせる予算。止める仕組みは持たない。[ADR 0030](../../docs/adr/0030-budget-alert-in-bootstrap.md)）。

変数 `budget_alert_email` は必須で、通知の宛先を書く。`monthly_budget_usd` は予算の額（USD、既定は 2）。額を変えるときはコンソールでなく `terraform.tfvars` を書き換えて適用し直す（コンソールで変えると次の適用で戻る）。すでにこのモジュールを適用した人は、`terraform.tfvars` に `budget_alert_email` を足してから適用し直す。

変数 `github_oidc_sub_prefix` は必須。`gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix` の出力をそのまま書く（形はリポジトリの設定で変わる。[ADR 0029](../../docs/adr/0029-trust-the-actual-github-oidc-subject.md)）。OIDC プロバイダが既にあるアカウント（ランディングゾーンが作った場合など）では、`terraform.tfvars` に `create_github_oidc_provider = false` と書く（同じ URL のプロバイダは 1 アカウントに 1 つしか作れない）。すでにこのモジュールを適用した人は、`terraform.tfvars` の `github_repository` を `github_oidc_sub_prefix` に書き換えてから適用し直す。

バケット名は `<project_name>-<environment>-s3-state-<アカウントID>-<リージョン>-an`。アカウントIDはデプロイ先から引くので渡さない。リージョンは変数 `region` で渡し、名前にはプロバイダの値を使う（[ADR 0005](../../docs/adr/0005-resource-naming.md)）。

## 適用の手順

AWS の認証情報（プロファイルなど）を設定した状態で、このフォルダで行う。git worktree の中では適用しない。worktree を消すと、gitignore 対象の `terraform.tfstate` も一緒に消える。

例外は、main に無いコードを当てるとき。次の 3 本の形で、状態ファイルと変数は main 側のファイルを指す。`.claude/worktrees/<名前>` に置いた worktree のルートで、`terraform -chdir=infra/bootstrap init` の後に流す。`<S>` は `../../../../../infra/bootstrap/terraform.tfstate`、`<V>` は `../../../../../infra/bootstrap/terraform.tfvars`。`-state` の `Deprecated flag` の警告は想定内。`tfplan` には宛先とアカウントIDが平文で入るので、適用しなかったときも消す（名前は変えない。gitignore 対象はこの名前と `*.tfplan` だけ）。宛先の形が検証で落ちると、エラーに `terraform.tfvars` の該当行が出るので、貼らずに本人が直す。

```
terraform -chdir=infra/bootstrap plan -input=false -no-color -state=<S> -var-file=<V> -out=tfplan > /dev/null
terraform -chdir=infra/bootstrap show -no-color tfplan
terraform -chdir=infra/bootstrap apply -input=false -no-color -state=<S> tfplan
```

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

   譜面の共有を使うときは、次の 4 つも入れる（省略可。未設定でもワークフローは失敗せず、共有の部品が作られないだけ）。Google の 3 つ（`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`COGNITO_DOMAIN_PREFIX`）は、そろえて入れる（一部だけだと Terraform の検証で失敗する）。値はコマンドの引数に書かず、`gh secret set <名前>` の対話入力で渡す。

   | 名前 | 内容 |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | Google の OAuth クライアント ID |
   | `GOOGLE_CLIENT_SECRET` | Google の OAuth クライアントシークレット |
   | `COGNITO_DOMAIN_PREFIX` | Cognito のホステッド UI のドメインの接頭辞（リージョン内で重ならない名前） |
   | `TURNSTILE_SITE_KEY` | Cloudflare Turnstile のサイトキー（画面のビルドに渡す） |

   Turnstile の秘密鍵は Secrets に入れない。SSM のパラメータ `/<project_name>/<environment>/turnstile-secret`（既定は `/shirabe/prd/turnstile-secret`）に、手で SecureString として作る。

`apply` はアカウントに実際にバケットとロールと予算を作るので、本人が承認してから行う。

適用の後、Budgets のコンソールの予算の詳細にある `Email verification` で、宛先の状態が `Verified` であることを確かめる。まだなら、検証メール（期限 12 時間）のリンクを開いてこのアカウントにサインインする。メールが無いときや期限が切れたときは、同じ欄から送り直す。検証が済むまで通知は届かない。

Budgets を SCP で拒否するアカウントでは、適用が失敗する（[ADR 0030](../../docs/adr/0030-budget-alert-in-bootstrap.md)）。

## テスト

検査コマンドは [CLAUDE.md](../../CLAUDE.md) のテストコマンドを参照。
