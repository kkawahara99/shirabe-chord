provider "aws" {
  region = var.region
}

# アカウントIDとリージョンは、渡さずにデプロイ先から引く（docs/adr/0005-resource-naming.md）
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  # default_tags はモックの下で tags_all に現れずテストで確かめられないため、リソースの tags に直接付ける（infra/README.md）
  tags = {
    Project = "shirabe-chord"
  }

  # <プロジェクト名>-<環境名>-s3-state-<アカウントID>-<リージョン>-an
  state_bucket_name = "${var.project_name}-${var.environment}-s3-state-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}-an"

  # 配信先（infra/app の S3）。名前は本体側と揃える。ロールの権限は、前方一致でなくこの正確な名前に絞る
  site_bucket_name = "${var.project_name}-${var.environment}-s3-site-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}-an"

  # 本体の状態ファイルのキー。backend_config_example と、ロールの権限（github_actions.tf）で共有する
  app_state_key = "app/terraform.tfstate"
  app_lock_key  = "${local.app_state_key}.tflock"

  # <プロジェクト名>-<環境名>-iam-<用途>（64 文字以内）
  deploy_role_name = "${var.project_name}-${var.environment}-iam-deploy"
  plan_role_name   = "${var.project_name}-${var.environment}-iam-plan"

  # <プロジェクト名>-<環境名>-budgets-<用途>
  budget_name = "${var.project_name}-${var.environment}-budgets-monthly"
}

resource "aws_s3_bucket" "state" {
  bucket           = local.state_bucket_name
  bucket_namespace = "account-regional"
  tags             = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.bucket

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.bucket

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.bucket

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ポリシーは jsonencode で書き、ARN は名前から組み立てる（aws_iam_policy_document はモックされて json が空になるため。infra/README.md）
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.bucket

  # ARN のパーティションは aws に固定する（中国・GovCloud のリージョンは対象外）
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          "arn:aws:s3:::${local.state_bucket_name}",
          "arn:aws:s3:::${local.state_bucket_name}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
    ]
  })

  # パブリックアクセスのブロックと同時に変更すると競合しうるため、順番を固定する
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# 上書きされて古くなった版だけを消す。現行の状態ファイルは、何日更新しなくても消えない
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.bucket

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  # バージョニングを先に有効にする（AWS の要件）
  depends_on = [aws_s3_bucket_versioning.state]
}
