# 出力（本体の backend に写す値）を確かめる。

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
