# バケット名の長さと環境名による変化を確かめる（docs/adr/0005-resource-naming.md）。

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

run "naming_最長入力でも63文字以内" {
  command = plan

  variables {
    project_name = "abcdefghij"
    environment  = "prd"
  }

  # 最長のリージョン名（14文字）に差し替える
  override_data {
    target          = data.aws_region.current
    override_during = plan
    values = {
      region = "ap-southeast-1"
    }
  }

  assert {
    condition     = aws_s3_bucket.state.bucket == "abcdefghij-prd-s3-state-123456789012-ap-southeast-1-an"
    error_message = "最長の入力でバケット名が形式どおりでない: ${aws_s3_bucket.state.bucket}"
  }

  assert {
    condition     = length(aws_s3_bucket.state.bucket) <= 63
    error_message = "バケット名が 63 文字を超えている（${length(aws_s3_bucket.state.bucket)} 文字）"
  }
}

run "naming_環境がdevでも形式どおり" {
  command = plan

  variables {
    environment = "dev"
  }

  assert {
    condition     = aws_s3_bucket.state.bucket == "shirabe-dev-s3-state-123456789012-ap-northeast-1-an"
    error_message = "dev のバケット名が形式どおりでない: ${aws_s3_bucket.state.bucket}"
  }
}

run "naming_環境がstgでも形式どおり" {
  command = plan

  variables {
    environment = "stg"
  }

  assert {
    condition     = aws_s3_bucket.state.bucket == "shirabe-stg-s3-state-123456789012-ap-northeast-1-an"
    error_message = "stg のバケット名が形式どおりでない: ${aws_s3_bucket.state.bucket}"
  }
}

run "naming_ロール名は既定値で形式どおり" {
  command = plan

  assert {
    condition     = aws_iam_role.deploy.name == "shirabe-prd-iam-deploy"
    error_message = "デプロイ用ロール名が shirabe-prd-iam-deploy でない: ${aws_iam_role.deploy.name}"
  }

  assert {
    condition     = aws_iam_role.plan.name == "shirabe-prd-iam-plan"
    error_message = "PR 用ロール名が shirabe-prd-iam-plan でない: ${aws_iam_role.plan.name}"
  }
}

run "naming_最長入力でもロール名は64文字以内" {
  command = plan

  variables {
    project_name = "abcdefghij"
    environment  = "prd"
  }

  assert {
    condition     = length(aws_iam_role.deploy.name) <= 64 && length(aws_iam_role.plan.name) <= 64
    error_message = "ロール名が 64 文字を超えている（${length(aws_iam_role.deploy.name)} 文字・${length(aws_iam_role.plan.name)} 文字）"
  }
}

run "naming_環境がdevだとロール名とサイト用バケット名もdevになる" {
  command = plan

  variables {
    environment = "dev"
  }

  assert {
    condition     = aws_iam_role.deploy.name == "shirabe-dev-iam-deploy" && aws_iam_role.plan.name == "shirabe-dev-iam-plan"
    error_message = "dev のロール名が形式どおりでない"
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.deploy.policy).Statement :
      s.Resource == ["arn:aws:s3:::shirabe-dev-s3-site-123456789012-ap-northeast-1-an"]
    ])
    error_message = "dev のサイト用バケット名が shirabe-dev-s3-site-<アカウントID>-<リージョン>-an でない"
  }
}

run "tags_ロール2つにProjectタグ" {
  command = plan

  assert {
    condition     = aws_iam_role.deploy.tags["Project"] == "shirabe-chord"
    error_message = "デプロイ用ロールに Project タグが shirabe-chord で付いていない"
  }

  assert {
    condition     = aws_iam_role.plan.tags["Project"] == "shirabe-chord"
    error_message = "PR 用ロールに Project タグが shirabe-chord で付いていない"
  }
}
