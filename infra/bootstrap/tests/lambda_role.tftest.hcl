# 共有の API（Lambda）の実行ロールを確かめる（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
# 名前の文字列は infra/app（#77）の tests/sharing_backend.tftest.hcl と同じ固定のもの。双方のテストが同じ文字列を確かめる。
# ポリシーは jsonencode で書いてあるので、jsondecode して中身を見る。Action と Resource は常に配列で書く。
# 架空のアカウントID 123456789012 とリージョン ap-northeast-1 で ARN が決まる。

variables {
  github_oidc_sub_prefix = "repo:example-owner@1000/example-repo@2000"
  budget_alert_email     = "alerts@example.com"
}

mock_provider "aws" {
  override_data {
    target          = data.aws_caller_identity.current
    override_during = plan
    values = {
      account_id = "123456789012"
    }
  }
  override_data {
    target          = data.aws_region.current
    override_during = plan
    values = {
      region = "ap-northeast-1"
    }
  }
}

run "実行ロール_名前はshirabe-prd-iam-lambda-apiで信頼先はlambda_amazonaws_comだけ" {
  command = plan

  assert {
    condition     = aws_iam_role.lambda_api.name == "shirabe-prd-iam-lambda-api"
    error_message = "実行ロールの名前が shirabe-prd-iam-lambda-api でない"
  }

  assert {
    condition = jsondecode(aws_iam_role.lambda_api.assume_role_policy).Statement == [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
    error_message = "信頼ポリシーが、lambda.amazonaws.com に sts:AssumeRole を許す 1 つの文だけでない"
  }

  assert {
    condition     = aws_iam_role.lambda_api.tags["Project"] == "shirabe-chord"
    error_message = "実行ロールに Project タグが付いていない"
  }
}

run "実行ロール_名前はproject_nameとenvironmentに追随し64文字以内" {
  command = plan

  variables {
    project_name = "abcdefghij"
    environment  = "dev"
  }

  assert {
    condition     = aws_iam_role.lambda_api.name == "abcdefghij-dev-iam-lambda-api"
    error_message = "実行ロールの名前がプロジェクト名・環境名に追随していない"
  }

  assert {
    condition     = length(aws_iam_role.lambda_api.name) <= 64
    error_message = "実行ロール名が 64 文字を超えている"
  }

  # 許可の名前も追随する（既定の名前のままだと、別の環境のテーブルを指してしまう）
  assert {
    condition = toset(flatten([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s.Resource])) == toset([
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/abcdefghij-dev-dynamodb-shares",
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/abcdefghij-dev-dynamodb-shares/index/owner-index",
      "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/abcdefghij-dev-lambda-api:*",
      "arn:aws:ssm:ap-northeast-1:123456789012:parameter/abcdefghij/dev/turnstile-secret",
    ])
    error_message = "許可の対象がプロジェクト名・環境名に追随していない"
  }
}

run "実行ロール_DynamoDBはテーブルと索引owner-indexの正確なARNだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "dynamodb:")])
      ] == [{
        Sid    = "SharesTable"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares",
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares/index/owner-index",
        ]
    }]
    error_message = "DynamoDB の許可が、テーブルと索引の正確な ARN への GetItem・PutItem・DeleteItem・Query の 1 つの文だけでない"
  }
}

run "実行ロール_ログは正確なロググループのストリームだけ" {
  command = plan

  # ロググループは infra/app が作る（保持期間を決めるため）。Lambda は書き込むだけ。CreateLogGroup は与えない
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "logs:")])
      ] == [{
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api:*"]
    }]
    error_message = "ログの許可が、正確なロググループのログストリームへの CreateLogStream・PutLogEvents の 1 つの文だけでない"
  }
}

run "実行ロール_SSMはturnstile-secretへのGetParameterだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "ssm:")])
      ] == [{
        Sid      = "TurnstileSecret"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["arn:aws:ssm:ap-northeast-1:123456789012:parameter/shirabe/prd/turnstile-secret"]
    }]
    error_message = "SSM の許可が、/shirabe/prd/turnstile-secret への GetParameter の 1 つの文だけでない"
  }
}

run "実行ロール_Resourceにアスタリスクが無くサービスはdynamodbとlogsとssmだけ" {
  command = plan

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s.Effect == "Allow" && !contains(keys(s), "NotAction") && !contains(keys(s), "NotResource")])
    error_message = "Allow 以外の文か、NotAction・NotResource がある"
  }

  assert {
    condition     = alltrue(flatten([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : [for r in s.Resource : r != "*"]]))
    error_message = "Resource が * の許可がある"
  }

  assert {
    condition     = alltrue(flatten([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : [for a in s.Action : !strcontains(a, "*")]]))
    error_message = "アクションにワイルドカードがある"
  }

  assert {
    condition     = toset(flatten([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : [for a in s.Action : split(":", a)[0]]])) == toset(["dynamodb", "logs", "ssm"])
    error_message = "dynamodb・logs・ssm 以外のサービスの許可がある"
  }
}

# infra/app の tests/sharing_backend.tftest.hcl の「固定の名前_既定値で指定の文字列」と同じ文字列
run "実行ロール_名前の文字列がinfra_appのテストと同じ" {
  command = plan

  assert {
    condition = toset(flatten([for s in jsondecode(aws_iam_role_policy.lambda_api.policy).Statement : s.Resource])) == toset([
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares",
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares/index/owner-index",
      "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api:*",
      "arn:aws:ssm:ap-northeast-1:123456789012:parameter/shirabe/prd/turnstile-secret",
    ])
    error_message = "許可の対象が、shirabe-prd-dynamodb-shares・owner-index・/aws/lambda/shirabe-prd-lambda-api・/shirabe/prd/turnstile-secret の 4 つだけでない"
  }
}
