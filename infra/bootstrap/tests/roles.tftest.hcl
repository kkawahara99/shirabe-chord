# デプロイ用・PR 用ロールの信頼ポリシーと権限を確かめる（docs/adr/0003-account-agnostic.md）。
# 確かめるのはポリシーの条件までで、トリガーの危険（pull_request_target など）はワークフロー側で守る。
# ポリシーは jsonencode で書いてあるので、jsondecode して中身を見る。Action と Resource は常に配列で書く。
# 架空のアカウントID 123456789012 とリージョン ap-northeast-1 でバケット名が決まる。
#   状態ファイル用: shirabe-prd-s3-state-123456789012-ap-northeast-1-an
#   サイト用:       shirabe-prd-s3-site-123456789012-ap-northeast-1-an

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

# --- 信頼ポリシー ---

run "trust_デプロイ用はaudとsubがmainに完全一致" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition == {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:example-owner@1000/example-repo@2000:ref:refs/heads/main"
      }
    }
    error_message = "デプロイ用ロールの条件が StringEquals の aud=sts.amazonaws.com と sub=<接頭辞>:ref:refs/heads/main だけでない"
  }
}

run "trust_PR用はaudとsubがpull_requestに完全一致" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition == {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:example-owner@1000/example-repo@2000:pull_request"
      }
    }
    error_message = "PR 用ロールの条件が StringEquals の aud=sts.amazonaws.com と sub=<接頭辞>:pull_request だけでない"
  }
}

run "trust_github_oidc_sub_prefixを変えるとsubも変わる" {
  command = plan

  variables {
    github_oidc_sub_prefix = "repo:other-owner@3000/other.repo@4000"
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner@3000/other.repo@4000:ref:refs/heads/main"
    error_message = "デプロイ用ロールの sub が github_oidc_sub_prefix に追従していない"
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner@3000/other.repo@4000:pull_request"
    error_message = "PR 用ロールの sub が github_oidc_sub_prefix に追従していない"
  }
}

run "trust_従来の形の接頭辞でもsubを組み立てる" {
  command = plan

  variables {
    github_oidc_sub_prefix = "repo:other-owner/other.repo"
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner/other.repo:ref:refs/heads/main"
    error_message = "従来の形で、デプロイ用ロールの sub が repo:<owner>/<repo>:ref:refs/heads/main にならない"
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner/other.repo:pull_request"
    error_message = "従来の形で、PR 用ロールの sub が repo:<owner>/<repo>:pull_request にならない"
  }
}

run "trust_どちらもワイルドカードを含まない" {
  command = plan

  assert {
    condition     = !strcontains(aws_iam_role.deploy.assume_role_policy, "*") && !strcontains(aws_iam_role.deploy.assume_role_policy, "StringLike")
    error_message = "デプロイ用ロールの信頼ポリシーに * か StringLike が入っている"
  }

  assert {
    condition     = !strcontains(aws_iam_role.plan.assume_role_policy, "*") && !strcontains(aws_iam_role.plan.assume_role_policy, "StringLike")
    error_message = "PR 用ロールの信頼ポリシーに * か StringLike が入っている"
  }
}

run "trust_ActionはAssumeRoleWithWebIdentityだけ" {
  command = plan

  assert {
    condition = alltrue([
      for role_policy in [aws_iam_role.deploy.assume_role_policy, aws_iam_role.plan.assume_role_policy] :
      length(jsondecode(role_policy).Statement) == 1
      && jsondecode(role_policy).Statement[0].Effect == "Allow"
      && jsondecode(role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
      && jsondecode(role_policy).Statement[0].Principal == { Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
    ])
    error_message = "信頼ポリシーが、GitHub の OIDC プロバイダだけを Principal にして sts:AssumeRoleWithWebIdentity を許す 1 つの文でない"
  }
}

# --- PR 用ロールの権限 ---

run "plan_EffectはAllowだけでNotActionとNotResourceが無い" {
  command = plan

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Effect == "Allow"])
    error_message = "Allow 以外の文がある"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : !contains(keys(s), "NotAction") && !contains(keys(s), "NotResource")])
    error_message = "NotAction か NotResource がある"
  }
}

# API Gateway の読み取りの許可は、アクション名が大文字の apigateway:GET（Get で始まらない）なので、判定に名指しで加える。
# 書き込みの POST・PUT・PATCH・DELETE は加えない（別のテストで、API Gateway の許可が GET だけであることを確かめる）
run "plan_ロック用の文を除き許可アクションはGet_List_Describeかapigateway_GETで始まる" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : alltrue([
        for a in s.Action : a == "apigateway:GET" || anytrue([for prefix in ["Get", "List", "Describe"] : startswith(split(":", a)[1], prefix)])
      ])
      if s.Resource != ["arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate.tflock"]
    ])
    error_message = "ロック用オブジェクトの文以外に、Get・List・Describe で始まらないアクションがある"
  }
}

run "plan_全体のワイルドカードとサービス単位のワイルドカードが無い" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : a != "*" && !can(regex("^[a-z0-9-]+:\\*$", a))
      ]
    ]))
    error_message = "* かサービス単位の *（s3:* など）がある"
  }
}

# apigateway:GET は読み取り（大文字で書くため Get の接頭辞に当たらない）なので、書き込みの数え方から除く
run "plan_書き込みの許可はロック用オブジェクトのPutObjectとDeleteObjectだけ" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : a if a != "apigateway:GET" && !anytrue([for prefix in ["Get", "List", "Describe"] : startswith(split(":", a)[1], prefix)])
      ]
    ])) == toset(["s3:PutObject", "s3:DeleteObject"])
    error_message = "書き込み系の許可が s3:PutObject と s3:DeleteObject だけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if contains(s.Action, "s3:PutObject") || contains(s.Action, "s3:DeleteObject")
      ] == [{
        Sid      = "StateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate.tflock"]
    }]
    error_message = "書き込みの許可が、app/terraform.tfstate.tflock だけを対象にした 1 つの文でない"
  }
}

run "plan_状態ファイル本体はGetObjectだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Action
      if s.Resource == ["arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate"]
    ] == [["s3:GetObject"]]
    error_message = "app/terraform.tfstate に許すのが s3:GetObject だけでない"
  }
}

run "plan_ListBucketは状態ファイル用バケットだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Resource
      if contains(s.Action, "s3:ListBucket")
    ] == [["arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an"]]
    error_message = "s3:ListBucket の対象が状態ファイル用バケットだけでない"
  }
}

run "plan_サイト用バケットはGet_Listで正確な名前" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Action
      if s.Resource == ["arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an"]
    ] == [["s3:Get*", "s3:List*"]]
    error_message = "サイト用バケットに許すのが、正確な名前への s3:Get* と s3:List* だけでない"
  }
}

run "plan_S3の対象は4つだけ" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Resource
      if anytrue([for a in s.Action : startswith(a, "s3:")])
      ])) == toset([
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an",
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate",
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate.tflock",
      "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an",
    ])
    error_message = "S3 の権限の対象が、状態ファイル用バケット・app/ の 2 つのキー・サイト用バケットの 4 つだけでない（足された文がある）"
  }
}

# 残す条件。共有の部品を足しても、PR 用ロールは状態ファイルとサイトのバケットに書き込めない
run "plan_状態ファイルとサイトのバケットへの書き込みが無い" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : !contains(["s3:PutObject", "s3:DeleteObject"], a)
      ]
      if anytrue([for r in s.Resource : strcontains(r, "-s3-site-") || endswith(r, "app/terraform.tfstate")])
    ]))
    error_message = "状態ファイル本体かサイト用バケットに、s3:PutObject か s3:DeleteObject を許す文がある"
  }

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : !anytrue([for w in ["s3:Put", "s3:Delete", "s3:Create", "s3:Replicate", "s3:Restore"] : startswith(a, w)])
      ]
      if anytrue([for r in s.Resource : strcontains(r, "-s3-site-")])
    ]))
    error_message = "サイト用バケットへの書き込み系の許可がある"
  }
}

# 共有の部品を足したので、CloudFront の 1 文だけだった条件を 3 文に広げる。
# Cognito のユーザープールと API Gateway の API は ARN が ID（作るまで決まらない）なので、名前では絞れない
run "plan_Resourceがアスタリスクの文はcloudfrontとcognito_idpとapigatewayの3つだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Action
      if s.Resource == ["*"]
      ] == [
      ["cloudfront:Get*", "cloudfront:List*"],
      [
        "cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:GetLogDeliveryConfiguration",
        "cognito-idp:DescribeIdentityProvider", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListTagsForResource",
      ],
      ["apigateway:GET"],
    ]
    error_message = "Resource が * の文が、CloudFront・Cognito・API Gateway の読み取りの 3 つだけでない"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement :
      alltrue([for a in s.Action : contains(["cloudfront", "cognito-idp", "apigateway"], split(":", a)[0])])
      if contains(s.Resource, "*")
    ])
    error_message = "Resource に * を含む文に、CloudFront・Cognito・API Gateway 以外のアクションがある"
  }
}

run "plan_DynamoDBとLambdaとCloudFrontFunctionは読み取りだけで正確な名前のARN" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "dynamodb:")])
      ] == [{
        Sid    = "SharesTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive",
          "dynamodb:DescribeKinesisStreamingDestination", "dynamodb:ListTagsOfResource",
        ]
        Resource = [
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares",
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares/index/owner-index",
        ]
    }]
    error_message = "DynamoDB の許可が、正確なテーブルと索引への読み取りの 1 つの文だけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "lambda:")])
      ] == [{
        Sid      = "ApiFunctionRead"
        Effect   = "Allow"
        Action   = ["lambda:Get*", "lambda:List*"]
        Resource = ["arn:aws:lambda:ap-northeast-1:123456789012:function:shirabe-prd-lambda-api"]
    }]
    error_message = "Lambda の許可が、正確な関数名への lambda:Get* と lambda:List* の 1 つの文だけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if contains(s.Action, "cloudfront:DescribeFunction")
      ] == [{
        Sid      = "SpaFunctionRead"
        Effect   = "Allow"
        Action   = ["cloudfront:DescribeFunction"]
        Resource = ["arn:aws:cloudfront::123456789012:function/shirabe-prd-cloudfront-spa"]
    }]
    error_message = "cloudfront:DescribeFunction の許可が、正確な関数名の ARN への 1 つの文だけでない"
  }
}

run "plan_DescribeLogGroupsはlog_group_アスタリスクで他のLogsは正確なロググループ" {
  command = plan

  # logs:DescribeLogGroups は特定のロググループの ARN では許可できない（一覧を引く API）ので、例外として log-group:* に許す
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if contains(s.Action, "logs:DescribeLogGroups")
      ] == [{
        Sid      = "LogGroupsDescribe"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = ["arn:aws:logs:ap-northeast-1:123456789012:log-group:*"]
    }]
    error_message = "logs:DescribeLogGroups が、log-group:* だけを対象にした 1 つの文でない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "logs:")]) && !contains(s.Action, "logs:DescribeLogGroups")
      ] == [{
        Sid    = "ApiLogGroupRead"
        Effect = "Allow"
        Action = ["logs:ListTagsForResource", "logs:ListTagsLogGroup"]
        Resource = [
          "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api",
          "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api:*",
        ]
    }]
    error_message = "ロググループの読み取りが、正確なロググループへの ListTags の 1 つの文だけでない"
  }
}

# List*/Describe* の包括を使うと ListUsers などでユーザーの一覧が読める。名指しの読み取りだけを許す
run "plan_Cognitoの許可に包括のワイルドカードとユーザーの一覧が無い" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : !strcontains(a, "*") && !strcontains(a, "ListUsers")
        if startswith(a, "cognito-idp:")
      ]
    ]))
    error_message = "PR 用ロールの Cognito の許可に、ワイルドカードか ListUsers がある"
  }
}

run "plan_API_Gatewayの許可はGETだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Action
      if anytrue([for a in s.Action : startswith(a, "apigateway:")])
    ] == [["apigateway:GET"]]
    error_message = "API Gateway の許可が apigateway:GET だけの 1 つの文でない"
  }
}

# 使ってよいサービスの一覧に、共有の部品のサービスを足した（iam・ssm・budgets などは引き続き無い）
run "plan_使うサービスはs3とcloudfrontと共有の部品のサービスだけ" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [for a in s.Action : split(":", a)[0]]
    ])) == toset(["s3", "cloudfront", "dynamodb", "lambda", "logs", "cognito-idp", "apigateway"])
    error_message = "s3・cloudfront・dynamodb・lambda・logs・cognito-idp・apigateway 以外のサービス（iam・ssm・budgets など）の権限がある"
  }
}

# --- デプロイ用ロールの権限 ---

run "deploy_EffectはAllowだけでNotActionとNotResourceが無い" {
  command = plan

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Effect == "Allow"])
    error_message = "Allow 以外の文がある"
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : !contains(keys(s), "NotAction") && !contains(keys(s), "NotResource")])
    error_message = "NotAction か NotResource がある"
  }
}

run "deploy_S3の対象は5つだけで状態ファイルはappの2つのキーに限られる" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource
      if anytrue([for a in s.Action : startswith(a, "s3:")])
      ])) == toset([
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an",
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate",
      "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate.tflock",
      "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an",
      "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an/*",
    ])
    error_message = "S3 の権限の対象が、状態ファイル用バケット本体・app/ の 2 つのキー・サイト用バケットとその中身の 5 つだけでない（足された文がある）"
  }
}

run "deploy_状態ファイルのListBucketはバケットだけ本体とロック用はGet_Put_Delete" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Resource
      if contains(s.Action, "s3:ListBucket")
    ] == [["arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an"]]
    error_message = "s3:ListBucket の対象が状態ファイル用バケットだけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action
      if s.Resource == [
        "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate",
        "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/app/terraform.tfstate.tflock",
      ]
    ] == [["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]]
    error_message = "状態ファイルとロック用オブジェクトに許すのが s3:GetObject・s3:PutObject・s3:DeleteObject だけでない"
  }
}

run "deploy_サイト用バケットは正確な名前で前方一致のワイルドカードが無い" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action
      if s.Resource == ["arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an"]
      ] == [[
        "s3:CreateBucket", "s3:DeleteBucket", "s3:Get*", "s3:List*",
        "s3:PutBucket*", "s3:PutEncryptionConfiguration", "s3:PutLifecycleConfiguration",
    ]]
    error_message = "サイト用バケット（正確な名前）に許すアクションが Issue の指定どおりでない"
  }

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [
        for r in s.Resource : !strcontains(split("/", r)[0], "*")
        if strcontains(r, "-s3-site-")
      ]
    ]))
    error_message = "サイト用バケットの名前の部分にワイルドカードがある"
  }
}

run "deploy_サイト用の中身はPutObjectとDeleteObjectだけ" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action
      if s.Resource == ["arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an/*"]
    ] == [["s3:PutObject", "s3:DeleteObject"]]
    error_message = "サイト用バケットの中身に許すのが s3:PutObject と s3:DeleteObject だけでない"
  }
}

# 共有の部品を足したので、Resource が * の文を CloudFront の 1 文から、CloudFront・Cognito・API Gateway の 3 文に広げる。
# 作成時に ARN が決まらない（ユーザープールと API の ARN は ID）ため、名前では絞れない
run "deploy_Resourceがアスタリスクの文はCloudFrontとCognitoとAPI_Gatewayの3つでIssueどおり" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action
      if s.Resource == ["*"]
      ] == [
      [
        "cloudfront:*Distribution*", "cloudfront:*OriginAccessControl*", "cloudfront:*ResponseHeadersPolicy*",
        "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation",
        "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource",
      ],
      [
        "cognito-idp:CreateUserPool", "cognito-idp:DeleteUserPool", "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool",
        "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:GetLogDeliveryConfiguration",
        "cognito-idp:CreateIdentityProvider", "cognito-idp:DeleteIdentityProvider", "cognito-idp:DescribeIdentityProvider", "cognito-idp:UpdateIdentityProvider",
        "cognito-idp:CreateUserPoolClient", "cognito-idp:DeleteUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:CreateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain", "cognito-idp:DescribeUserPoolDomain", "cognito-idp:UpdateUserPoolDomain",
        "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource",
      ],
      ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"],
    ]
    error_message = "Resource が * の文が、CloudFront・Cognito・API Gateway の指定どおりのアクションの 3 つだけでない"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      alltrue([for a in s.Action : contains(["cloudfront", "cognito-idp", "apigateway"], split(":", a)[0])])
      if contains(s.Resource, "*")
    ])
    error_message = "Resource に * を含む文に、CloudFront・Cognito・API Gateway 以外のアクションがある"
  }
}

run "deploy_DynamoDBとLambdaとCloudFrontFunctionは正確な名前のARNで前方一致が無い" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "dynamodb:")])
      ] == [{
        Sid    = "SharesTable"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:UpdateTable",
          "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive",
          "dynamodb:DescribeKinesisStreamingDestination", "dynamodb:ListTagsOfResource",
          "dynamodb:TagResource", "dynamodb:UntagResource",
        ]
        Resource = [
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares",
          "arn:aws:dynamodb:ap-northeast-1:123456789012:table/shirabe-prd-dynamodb-shares/index/owner-index",
        ]
    }]
    error_message = "DynamoDB の許可が、正確なテーブルと索引への 1 つの文（指定のアクション）だけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "lambda:")])
      ] == [{
        Sid    = "ApiFunction"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:GetPolicy",
          "lambda:ListVersionsByFunction", "lambda:AddPermission", "lambda:RemovePermission",
          "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
        ]
        Resource = ["arn:aws:lambda:ap-northeast-1:123456789012:function:shirabe-prd-lambda-api"]
    }]
    error_message = "Lambda の許可が、正確な関数名への 1 つの文（指定のアクション）だけでない"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if contains(s.Action, "cloudfront:CreateFunction")
      ] == [{
        Sid    = "SpaFunction"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateFunction", "cloudfront:UpdateFunction", "cloudfront:DeleteFunction",
          "cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:PublishFunction",
        ]
        Resource = ["arn:aws:cloudfront::123456789012:function/shirabe-prd-cloudfront-spa"]
    }]
    error_message = "CloudFront Function の許可が、正確な関数名の ARN への 1 つの文（指定のアクション）だけでない"
  }

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [
        for r in s.Resource : !strcontains(r, "*")
      ]
      if anytrue([for a in s.Action : anytrue([for svc in ["dynamodb:", "lambda:"] : startswith(a, svc)])]) || contains(s.Action, "cloudfront:CreateFunction")
    ]))
    error_message = "DynamoDB・Lambda・CloudFront Function の対象にワイルドカードがある"
  }
}

run "deploy_Logsは正確なロググループでDescribeLogGroupsだけlog_group_アスタリスク" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "logs:")]) && !contains(s.Action, "logs:DescribeLogGroups")
      ] == [{
        Sid    = "ApiLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
          "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:ListTagsLogGroup",
        ]
        Resource = [
          "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api",
          "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/shirabe-prd-lambda-api:*",
        ]
    }]
    error_message = "ロググループの許可が、正確なロググループへの 1 つの文（指定のアクション）だけでない"
  }

  # logs:DescribeLogGroups は特定のロググループの ARN では許可できない（一覧を引く API）ので、例外として log-group:* に許す
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if contains(s.Action, "logs:DescribeLogGroups")
      ] == [{
        Sid      = "LogGroupsDescribe"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = ["arn:aws:logs:ap-northeast-1:123456789012:log-group:*"]
    }]
    error_message = "logs:DescribeLogGroups が、log-group:* だけを対象にした 1 つの文でない"
  }
}

run "deploy_IAMはPassRoleだけで対象は実行ロールで条件つき" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s
      if anytrue([for a in s.Action : startswith(a, "iam:")])
      ] == [{
        Sid       = "PassLambdaApiRole"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = ["arn:aws:iam::123456789012:role/shirabe-prd-iam-lambda-api"]
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
    }]
    error_message = "IAM の許可が、実行ロールだけを対象に iam:PassedToService=lambda.amazonaws.com の条件つきの iam:PassRole の 1 つの文でない"
  }
}

run "deploy_ロールやポリシーを作る書き込みが無い" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [
        for a in s.Action : !contains([
          "iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:UpdateAssumeRolePolicy",
          "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeleteRole", "iam:*",
        ], a)
      ]
    ]))
    error_message = "ロールの作成・ポリシーの書き込みなど、権限を広げうる IAM の許可がある"
  }

  # ロールは infra/bootstrap だけが作る。デプロイ用ロールが持つ IAM の許可は iam:PassRole だけ
  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [
        for a in s.Action : a == "iam:PassRole"
        if startswith(a, "iam:")
      ]
    ]))
    error_message = "iam:PassRole 以外の IAM の許可がある"
  }
}

# 使ってよいサービスの一覧に、共有の部品のサービスを足した（ssm は足さない。Turnstile の秘密鍵は Terraform が作らない）
run "deploy_使うサービスはs3とcloudfrontと共有の部品のサービスだけでssmは無い" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [for a in s.Action : split(":", a)[0]]
    ])) == toset(["s3", "cloudfront", "dynamodb", "lambda", "logs", "cognito-idp", "apigateway", "iam"])
    error_message = "s3・cloudfront・dynamodb・lambda・logs・cognito-idp・apigateway・iam 以外のサービス（ssm・budgets など）の権限がある"
  }
}
