# GitHub Actions が長期の鍵なしで AWS に入るための OIDC プロバイダと 2 つのロール（docs/adr/0003-account-agnostic.md）。
# 信頼ポリシーの sub が守るのは「どのリポジトリのどの ref か」まで。pull_request_target など危険なトリガーを
# main 上で動かさないことは、ワークフロー側のテストで守る。

locals {
  github_oidc_host = "token.actions.githubusercontent.com"

  # ARN は名前から組み立てる（作る場合も既存を使う場合も同じ。plan の時点で決まる）
  github_oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.github_oidc_host}"

  state_bucket_arn = "arn:aws:s3:::${local.state_bucket_name}"
  state_object_arn = "${local.state_bucket_arn}/${local.app_state_key}"
  lock_object_arn  = "${local.state_bucket_arn}/${local.app_lock_key}"
  site_bucket_arn  = "arn:aws:s3:::${local.site_bucket_name}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  tags           = local.tags
}

# 既存を使う場合は、あることだけを確かめる（無ければ plan が失敗する）
data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = "https://${local.github_oidc_host}"
}

resource "aws_iam_role" "deploy" {
  name = local.deploy_role_name
  tags = local.tags

  # StringEquals の完全一致だけを使う（ワイルドカードは使わない）。GitHub の environment は使わない
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = local.github_oidc_provider_arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.github_oidc_host}:aud" = "sts.amazonaws.com"
            "${local.github_oidc_host}:sub" = "${var.github_oidc_sub_prefix}:ref:refs/heads/main"
          }
        }
      },
    ]
  })

  # ARN を組み立てるとプロバイダへの参照が消えるので、作る順を固定する
  depends_on = [aws_iam_openid_connect_provider.github]
}

# 権限は M2 の本体（infra/app）に要る範囲に絞る。足りない分は実地で見つけて足す。API・認証・データ層は M4 で足す
resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.state_bucket_arn]
      },
      {
        Sid      = "StateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [local.state_object_arn, local.lock_object_arn]
      },
      {
        Sid    = "SiteBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:Get*",
          "s3:List*",
          "s3:PutBucket*",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
        ]
        Resource = [local.site_bucket_arn]
      },
      {
        # aws s3 sync --delete が要る
        Sid      = "SiteObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = ["${local.site_bucket_arn}/*"]
      },
      {
        # 作成時にリソースで絞れないため Resource は *
        Sid    = "CloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:*Distribution*",
          "cloudfront:*OriginAccessControl*",
          "cloudfront:*ResponseHeadersPolicy*",
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:ListTagsForResource",
        ]
        Resource = ["*"]
      },
    ]
  })
}

resource "aws_iam_role" "plan" {
  name = local.plan_role_name
  tags = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = local.github_oidc_provider_arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.github_oidc_host}:aud" = "sts.amazonaws.com"
            "${local.github_oidc_host}:sub" = "${var.github_oidc_sub_prefix}:pull_request"
          }
        }
      },
    ]
  })

  depends_on = [aws_iam_openid_connect_provider.github]
}

# 読み取りだけ。書き込みの許可は、状態ファイルのロック用オブジェクトの PutObject・DeleteObject だけ
resource "aws_iam_role_policy" "plan" {
  name = "plan"
  role = aws_iam_role.plan.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.state_bucket_arn]
      },
      {
        Sid      = "StateRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [local.state_object_arn]
      },
      {
        Sid      = "StateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [local.lock_object_arn]
      },
      {
        Sid      = "SiteBucketRead"
        Effect   = "Allow"
        Action   = ["s3:Get*", "s3:List*"]
        Resource = [local.site_bucket_arn]
      },
      {
        Sid      = "CloudFrontRead"
        Effect   = "Allow"
        Action   = ["cloudfront:Get*", "cloudfront:List*"]
        Resource = ["*"]
      },
    ]
  })
}
