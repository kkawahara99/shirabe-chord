# デプロイ用・PR 用ロールの信頼ポリシーと権限を確かめる（docs/adr/0003-account-agnostic.md）。
# 確かめるのはポリシーの条件までで、トリガーの危険（pull_request_target など）はワークフロー側で守る。
# ポリシーは jsonencode で書いてあるので、jsondecode して中身を見る。Action と Resource は常に配列で書く。
# 架空のアカウントID 123456789012 とリージョン ap-northeast-1 でバケット名が決まる。
#   状態ファイル用: shirabe-prd-s3-state-123456789012-ap-northeast-1-an
#   サイト用:       shirabe-prd-s3-site-123456789012-ap-northeast-1-an

variables {
  github_repository = "example-owner/example-repo"
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
        "token.actions.githubusercontent.com:sub" = "repo:example-owner/example-repo:ref:refs/heads/main"
      }
    }
    error_message = "デプロイ用ロールの条件が StringEquals の aud=sts.amazonaws.com と sub=repo:<repo>:ref:refs/heads/main だけでない"
  }
}

run "trust_PR用はaudとsubがpull_requestに完全一致" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition == {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:example-owner/example-repo:pull_request"
      }
    }
    error_message = "PR 用ロールの条件が StringEquals の aud=sts.amazonaws.com と sub=repo:<repo>:pull_request だけでない"
  }
}

run "trust_github_repositoryを変えるとsubも変わる" {
  command = plan

  variables {
    github_repository = "other-owner/other.repo"
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner/other.repo:ref:refs/heads/main"
    error_message = "デプロイ用ロールの sub が github_repository に追従していない"
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:other-owner/other.repo:pull_request"
    error_message = "PR 用ロールの sub が github_repository に追従していない"
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

run "plan_ロック用の文を除き許可アクションはGet_List_Describeで始まる" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : alltrue([
        for a in s.Action : anytrue([for prefix in ["Get", "List", "Describe"] : startswith(split(":", a)[1], prefix)])
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

run "plan_書き込みの許可はロック用オブジェクトのPutObjectとDeleteObjectだけ" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : [
        for a in s.Action : a if !anytrue([for prefix in ["Get", "List", "Describe"] : startswith(split(":", a)[1], prefix)])
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

run "plan_S3の対象は4つだけでアスタリスクの文はCloudFrontだけ" {
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

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement :
      alltrue([for a in s.Action : startswith(a, "cloudfront:")])
      if contains(s.Resource, "*")
    ])
    error_message = "Resource に * を含む文に、CloudFront 以外のアクションがある"
  }
}

run "plan_CloudFrontはGet_ListでResourceはアスタリスク" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.plan.policy).Statement : s.Action
      if s.Resource == ["*"]
    ] == [["cloudfront:Get*", "cloudfront:List*"]]
    error_message = "Resource が * の文が、cloudfront:Get* と cloudfront:List* だけの 1 つでない"
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

run "deploy_CloudFrontのアクションはIssueどおりでResourceはアスタリスク" {
  command = plan

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : s.Action
      if s.Resource == ["*"]
      ] == [[
        "cloudfront:*Distribution*", "cloudfront:*OriginAccessControl*", "cloudfront:*ResponseHeadersPolicy*",
        "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation",
        "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource",
    ]]
    error_message = "Resource が * の文が、CloudFront の指定どおりのアクションだけの 1 つでない"
  }
}

run "deploy_Resourceがアスタリスクの文はCloudFrontだけ" {
  command = plan

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      alltrue([for a in s.Action : startswith(a, "cloudfront:")])
      if contains(s.Resource, "*")
    ])
    error_message = "Resource に * を含む文に、CloudFront 以外のアクションがある"
  }
}

run "deploy_s3とcloudfront以外のサービスの権限が無い" {
  command = plan

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement : [for a in s.Action : split(":", a)[0]]
    ])) == toset(["s3", "cloudfront"])
    error_message = "s3 と cloudfront 以外のサービス（lambda・dynamodb・cognito・iam など）の権限がある"
  }
}
