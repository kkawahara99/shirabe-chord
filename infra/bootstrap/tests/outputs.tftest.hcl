# 出力（本体の backend に写す値）を確かめる。

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

run "outputs_バケット名の出力が実際のバケット名と一致" {
  command = plan

  assert {
    condition     = output.bucket_name == aws_s3_bucket.state.bucket
    error_message = "bucket_name の出力が実際のバケット名と違う"
  }
}

run "outputs_backendの例にbucket_key_region_use_lockfileが入る" {
  command = plan

  assert {
    condition     = strcontains(output.backend_config_example, "bucket = \"shirabe-prd-s3-state-123456789012-ap-northeast-1-an\"")
    error_message = "backend の例に bucket が入っていない"
  }

  assert {
    condition     = strcontains(output.backend_config_example, "key = \"app/terraform.tfstate\"")
    error_message = "backend の例に key が入っていない"
  }

  assert {
    condition     = strcontains(output.backend_config_example, "region = \"ap-northeast-1\"")
    error_message = "backend の例に region が入っていない"
  }

  assert {
    condition     = strcontains(output.backend_config_example, "use_lockfile = true")
    error_message = "backend の例に use_lockfile = true が入っていない"
  }
}

# ARN は apply まで決まらないので command = apply にする
run "outputs_ロールのARNの出力が実際のロールと一致" {
  command = apply

  assert {
    condition     = output.deploy_role_arn == aws_iam_role.deploy.arn
    error_message = "deploy_role_arn の出力がデプロイ用ロールの ARN と違う"
  }

  assert {
    condition     = output.plan_role_arn == aws_iam_role.plan.arn
    error_message = "plan_role_arn の出力が PR 用ロールの ARN と違う"
  }
}

run "outputs_ロールのARNの出力はsensitive" {
  command = plan

  assert {
    condition     = issensitive(output.deploy_role_arn) && issensitive(output.plan_role_arn)
    error_message = "ロールの ARN（アカウントIDを含む）の出力が sensitive でない"
  }
}
