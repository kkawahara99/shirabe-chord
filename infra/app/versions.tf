terraform {
  # S3 の backend の use_lockfile（1.11.0 で一般提供）と、テストの override_during（1.11.0 で追加）を使うため
  required_version = ">= 1.11"

  # 接続先（バケット名など）はアカウント固有の情報なので書かない。
  # terraform init -backend-config=backend.app.hcl で渡す（infra/README.md、infra/bootstrap の backend_config_example 出力）
  backend "s3" {
    # ロックの有無を backend.app.hcl の書き忘れに任せない。アカウント固有の値ではないのでコードに書く
    use_lockfile = true
  }

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # bucket_namespace（aws_s3_bucket）は 6.37.0 で追加された
      version = ">= 6.37.0, < 7.0"
    }
    # Lambda のコードを zip にする（sharing.tf）
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.7.0, < 3.0"
    }
  }
}
