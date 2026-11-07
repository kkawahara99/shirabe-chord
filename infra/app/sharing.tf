# 共有のデータ（DynamoDB）・API（Lambda と API Gateway）。方針は docs/adr/0035-share-by-unguessable-url-with-google-login.md、
# 配信（CloudFront の /api/*・/s/*・/mine）は main.tf。sharing_enabled（cognito.tf）が偽のあいだは何も作らない。
# 名前の文字列は infra/bootstrap（#78）の実行ロールの許可と同じ固定のもので、双方のテストが同じ文字列を確かめる。

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  lambda_api_name = "${local.name_prefix}-lambda-api"
  # 実行ロールは infra/bootstrap が作る。data で引くと iam:GetRole が要るため、ARN を名前から組み立てる
  lambda_api_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-iam-lambda-api"

  shares_table_name = "${local.name_prefix}-dynamodb-shares"
  owner_index_name  = "owner-index"

  # Turnstile の秘密鍵。値は Terraform で作らず（状態ファイルに入るため）、適用の前に手で作る。実行ロールは読み取りだけを許される（#78）
  turnstile_secret_parameter = "/${var.project_name}/${var.environment}/turnstile-secret"

  # Turnstile が返す hostname は、apps/api が 1 つの文字列と照合する。独自ドメインがあればその先頭、なければ CloudFront のドメイン
  turnstile_hostname = local.use_custom_domain ? var.domain_names[0] : aws_cloudfront_distribution.site.domain_name

  # 経路ごとの認可の有無。キーは apps/api/src/handler.ts の routeKey と同じ。閲覧だけが URL を知る人に開かれる
  api_routes = {
    "POST /api/shares"        = true
    "GET /api/shares"         = true
    "GET /api/shares/{id}"    = false
    "DELETE /api/shares/{id}" = true
  }
}

resource "aws_dynamodb_table" "shares" {
  count = local.sharing_enabled ? 1 : 0

  name         = local.shares_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  tags         = local.tags

  # 暗号化は書かない（既定の AWS 所有のキーで保存時に暗号化される）
  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "ownerSub"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # 一覧と件数を引く索引。id は主キーなので自動で入る。一覧に要る残りの項目（タイトル・コード数）だけを写す
  global_secondary_index {
    name               = local.owner_index_name
    hash_key           = "ownerSub"
    range_key          = "createdAt"
    projection_type    = "INCLUDE"
    non_key_attributes = ["title", "chordCount"]
  }
}

# ロググループは自前で作り、保持期間を決める（作らないと Lambda が保持期間なしで作る）
resource "aws_cloudwatch_log_group" "api" {
  count = local.sharing_enabled ? 1 : 0

  name              = "/aws/lambda/${local.lambda_api_name}"
  retention_in_days = 30
  tags              = local.tags
}

# apps/api のビルド成果物（1 ファイルの ESM）を zip にする。共有を使わないときは読まない
data "archive_file" "api" {
  count = local.sharing_enabled ? 1 : 0

  type        = "zip"
  source_file = var.api_bundle_path
  output_path = "${path.module}/.terraform/lambda-api.zip"
  # OS によるファイル権限の違いで zip のハッシュが変わり、手元と CI で毎回差分が出るのを防ぐ
  output_file_mode = "0666"
}

resource "aws_lambda_function" "api" {
  count = local.sharing_enabled ? 1 : 0

  function_name    = local.lambda_api_name
  role             = local.lambda_api_role_arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  memory_size      = 256
  timeout          = 10
  filename         = data.archive_file.api[0].output_path
  source_code_hash = data.archive_file.api[0].output_base64sha256
  tags             = local.tags

  # 変数名は apps/api/src/index.ts が読むもの
  environment {
    variables = {
      SHARES_TABLE               = aws_dynamodb_table.shares[0].name
      SHARES_OWNER_INDEX         = local.owner_index_name
      TURNSTILE_SECRET_PARAMETER = local.turnstile_secret_parameter
      TURNSTILE_HOSTNAME         = local.turnstile_hostname
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_apigatewayv2_api" "api" {
  count = local.sharing_enabled ? 1 : 0

  name          = "${local.name_prefix}-apigateway-api"
  protocol_type = "HTTP"
  tags          = local.tags
}

# 自前の検証は持たず、Cognito のトークンの署名・期限・宛先を API Gateway に任せる
resource "aws_apigatewayv2_authorizer" "cognito" {
  count = local.sharing_enabled ? 1 : 0

  api_id           = aws_apigatewayv2_api.api[0].id
  name             = "${local.name_prefix}-apigateway-cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.users[0].id}"
    audience = [aws_cognito_user_pool_client.web[0].id]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  count = local.sharing_enabled ? 1 : 0

  api_id                 = aws_apigatewayv2_api.api[0].id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.api[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each = local.sharing_enabled ? local.api_routes : {}

  api_id    = aws_apigatewayv2_api.api[0].id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.api[0].id}"

  authorization_type = each.value ? "JWT" : "NONE"
  authorizer_id      = each.value ? aws_apigatewayv2_authorizer.cognito[0].id : null
}

# ステージ名を $default にして、パスに /ステージ名 が付かないようにする（CloudFront の /api/* をそのまま渡すため）
resource "aws_apigatewayv2_stage" "api" {
  count = local.sharing_enabled ? 1 : 0

  api_id      = aws_apigatewayv2_api.api[0].id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags

  # 荒らし対策のスロットリング（1 秒あたり）。共有の作成だけ、さらに絞る
  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  route_settings {
    route_key              = "POST /api/shares"
    throttling_rate_limit  = 2
    throttling_burst_limit = 5
  }

  # 経路が無いうちに個別の設定を付けると API Gateway に拒まれる
  depends_on = [aws_apigatewayv2_route.api]
}

resource "aws_lambda_permission" "api" {
  count = local.sharing_enabled ? 1 : 0

  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api[0].execution_arn}/*/*"
}
