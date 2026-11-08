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

  # 共有の部品の ARN。名前から組み立てる（パーティションは aws に固定する）
  region_account = "${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}"

  shares_table_arn = "arn:aws:dynamodb:${local.region_account}:table/${local.shares_table_name}"
  owner_index_arn  = "${local.shares_table_arn}/index/${local.owner_index_name}"
  lambda_api_arn   = "arn:aws:lambda:${local.region_account}:function:${local.lambda_api_name}"
  # ロググループの ARN。ログストリームの ARN は末尾に :* が付く
  api_log_group_arn   = "arn:aws:logs:${local.region_account}:log-group:/aws/lambda/${local.lambda_api_name}"
  api_log_streams_arn = "${local.api_log_group_arn}:*"
  # logs:DescribeLogGroups は特定のロググループの ARN では許可できない（一覧を引く API）。log-group:* への例外として許す
  log_groups_all_arn = "arn:aws:logs:${local.region_account}:log-group:*"
  # CloudFront は global で、ARN にリージョンが入らない
  spa_function_arn    = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:function/${local.cloudfront_spa_function_name}"
  lambda_api_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.lambda_api_role_name}"
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

# 権限は infra/app に要る範囲に絞る。足りない分は実地で見つけて足す
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
      {
        Sid    = "SharesTable"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:UpdateTable",
          "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive",
          "dynamodb:DescribeKinesisStreamingDestination", "dynamodb:ListTagsOfResource",
          "dynamodb:TagResource", "dynamodb:UntagResource",
        ]
        Resource = [local.shares_table_arn, local.owner_index_arn]
      },
      {
        Sid    = "ApiFunction"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:GetPolicy",
          "lambda:ListVersionsByFunction", "lambda:AddPermission", "lambda:RemovePermission",
          "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
        ]
        Resource = [local.lambda_api_arn]
      },
      {
        Sid    = "ApiLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
          "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:ListTagsLogGroup",
        ]
        Resource = [local.api_log_group_arn, local.api_log_streams_arn]
      },
      {
        Sid      = "LogGroupsDescribe"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = [local.log_groups_all_arn]
      },
      {
        Sid    = "SpaFunction"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateFunction", "cloudfront:UpdateFunction", "cloudfront:DeleteFunction",
          "cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:PublishFunction",
        ]
        Resource = [local.spa_function_arn]
      },
      {
        # ユーザープールの ARN は ID（作るまで決まらない）なので、名前では絞れない。CloudFront の文と同じ扱い
        Sid    = "Cognito"
        Effect = "Allow"
        Action = [
          "cognito-idp:CreateUserPool", "cognito-idp:DeleteUserPool", "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool",
          "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:GetLogDeliveryConfiguration",
          "cognito-idp:CreateIdentityProvider", "cognito-idp:DeleteIdentityProvider", "cognito-idp:DescribeIdentityProvider", "cognito-idp:UpdateIdentityProvider",
          "cognito-idp:CreateUserPoolClient", "cognito-idp:DeleteUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:CreateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain", "cognito-idp:DescribeUserPoolDomain", "cognito-idp:UpdateUserPoolDomain",
          "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource",
        ]
        Resource = ["*"]
      },
      {
        # API の ARN は ID（作るまで決まらない）なので、名前では絞れない。CloudFront の文と同じ扱い。
        # TagResource は、タグ付きでステージを作るときに HTTP の動詞とは別に求められる（#82 の実適用で拒否された）
        Sid      = "ApiGateway"
        Effect   = "Allow"
        Action   = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE", "apigateway:TagResource"]
        Resource = ["*"]
      },
      {
        # 渡せるのは実行ロール 1 つ、渡し先は Lambda だけ。ロールの作成やポリシーの書き込みは与えない（権限を広げられないようにする。ADR 0035）
        Sid       = "PassLambdaApiRole"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = [local.lambda_api_role_arn]
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
      },
    ]
  })
}

# 共有の API（Lambda）の実行ロール。Google のクライアント ID の設定にかかわらず作る（ロールは無料で、使われなければ何も起きない。docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
# 関数と DynamoDB・ロググループの本体は infra/app が作り、ここでは名前で絞った許可だけを持つ
resource "aws_iam_role" "lambda_api" {
  name = local.lambda_api_role_name
  tags = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })
}

resource "aws_iam_role_policy" "lambda_api" {
  name = "lambda-api"
  role = aws_iam_role.lambda_api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SharesTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = [local.shares_table_arn, local.owner_index_arn]
      },
      {
        # ロググループは infra/app が作る。書き込むだけで、ロググループは作らせない
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.api_log_streams_arn]
      },
      {
        Sid      = "TurnstileSecret"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["arn:aws:ssm:${local.region_account}:parameter${local.turnstile_secret_parameter}"]
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
      {
        Sid    = "SharesTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive",
          "dynamodb:DescribeKinesisStreamingDestination", "dynamodb:ListTagsOfResource",
        ]
        Resource = [local.shares_table_arn, local.owner_index_arn]
      },
      {
        Sid      = "ApiFunctionRead"
        Effect   = "Allow"
        Action   = ["lambda:Get*", "lambda:List*"]
        Resource = [local.lambda_api_arn]
      },
      {
        Sid      = "ApiLogGroupRead"
        Effect   = "Allow"
        Action   = ["logs:ListTagsForResource", "logs:ListTagsLogGroup"]
        Resource = [local.api_log_group_arn, local.api_log_streams_arn]
      },
      {
        Sid      = "LogGroupsDescribe"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = [local.log_groups_all_arn]
      },
      {
        Sid      = "SpaFunctionRead"
        Effect   = "Allow"
        Action   = ["cloudfront:DescribeFunction"]
        Resource = [local.spa_function_arn]
      },
      {
        # ユーザープールの ARN は ID（作るまで決まらない）なので、名前では絞れない。CloudFront の文と同じ扱い。
        # List*/Describe* の包括は使わない（ListUsers でユーザーの一覧が読めるため）。plan の更新に要るものを名指しする
        Sid      = "CognitoRead"
        Effect   = "Allow"
        Action   = ["cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:GetLogDeliveryConfiguration", "cognito-idp:DescribeIdentityProvider", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DescribeUserPoolDomain", "cognito-idp:ListTagsForResource"]
        Resource = ["*"]
      },
      {
        # API の ARN は ID なので絞れない。読み取り（GET）だけ
        Sid      = "ApiGatewayRead"
        Effect   = "Allow"
        Action   = ["apigateway:GET"]
        Resource = ["*"]
      },
    ]
  })
}
