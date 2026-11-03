# バケット名の長さと環境名による変化を確かめる（docs/adr/0005-resource-naming.md）。

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
