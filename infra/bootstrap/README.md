# bootstrap

本体の状態ファイル（tfstate）を置く S3 バケットを作る、初回だけ手で適用するルートモジュール。自身の状態は手元のローカルに置く（backend を書かない）。`terraform.tfstate` は gitignore 対象だが、消さずに手元に残す。

作るのは状態ファイル用のバケット1つ。バージョニング・SSE-S3 の暗号化・パブリックアクセスの全ブロック・TLS 以外の拒否・古い版を 90 日で削除（現行の状態ファイルは消えない）・`prevent_destroy` を備える。GitHub Actions 用の OIDC プロバイダとデプロイ用のロールは、CI のマイルストーンで足す。

バケット名は `<project_name>-<environment>-s3-state-<アカウントID>-<リージョン>-an`。アカウントIDはデプロイ先から引くので渡さない。リージョンは変数 `region` で渡し、名前にはプロバイダの値を使う（[ADR 0005](../../docs/adr/0005-resource-naming.md)）。

## 適用の手順

AWS の認証情報（プロファイルなど）を設定した状態で、このフォルダで行う。

1. `terraform.tfvars.example` を `terraform.tfvars` にコピーし、値を決める。
2. `terraform init`
3. `terraform plan` で内容を確かめる。
4. `terraform apply`
5. `terraform output -raw backend_config_example` の出力を、`infra/app/` の `backend.app.hcl`（gitignore 対象）に写す。バケット名にアカウントIDが入るので、出力は貼らない。

`apply` はアカウントに実際にバケットを作るので、本人が承認してから行う。

## テスト

検査コマンドは [CLAUDE.md](../../CLAUDE.md) のテストコマンドを参照。
