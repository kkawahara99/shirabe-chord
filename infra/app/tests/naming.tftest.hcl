# 名前の組み立てと長さの上限を確かめる（docs/adr/0005-resource-naming.md）。
# アカウントID・リージョンはデータソースで引くため、override_data で架空の値を入れる。

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
  # plan では ID・ARN・ドメイン名などの計算値が不明で、それに頼る assert やポリシーの組み立てが unknown になる。架空の値で固定する
  override_resource {
    target          = aws_s3_bucket.site
    override_during = plan
    values = {
      bucket_regional_domain_name = "shirabe-prd-s3-site-123456789012-ap-northeast-1-an.s3.ap-northeast-1.amazonaws.com"
    }
  }
  override_resource {
    target          = aws_cloudfront_origin_access_control.site
    override_during = plan
    values = {
      id = "OACEXAMPLE"
    }
  }
  override_resource {
    target          = aws_cloudfront_response_headers_policy.site
    override_during = plan
    values = {
      id = "RHPEXAMPLE"
    }
  }
  override_resource {
    target          = aws_cloudfront_distribution.site
    override_during = plan
    values = {
      id          = "EDISTEXAMPLE"
      arn         = "arn:aws:cloudfront::123456789012:distribution/EDISTEXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
}

run "naming_既定値で形式どおり" {
  command = plan

  assert {
    condition     = aws_s3_bucket.site.bucket == "shirabe-prd-s3-site-123456789012-ap-northeast-1-an"
    error_message = "バケット名が shirabe-prd-s3-site-<アカウントID>-<リージョン>-an になっていない: ${aws_s3_bucket.site.bucket}"
  }

  assert {
    condition     = aws_s3_bucket.site.bucket_namespace == "account-regional"
    error_message = "bucket_namespace が account-regional でない"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.site.name == "shirabe-prd-cloudfront-site"
    error_message = "OAC の名前が shirabe-prd-cloudfront-site でない: ${aws_cloudfront_origin_access_control.site.name}"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.site.name == "shirabe-prd-cloudfront-site"
    error_message = "レスポンスヘッダポリシーの名前が shirabe-prd-cloudfront-site でない: ${aws_cloudfront_response_headers_policy.site.name}"
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
    condition     = aws_s3_bucket.site.bucket == "abcdefghij-prd-s3-site-123456789012-ap-southeast-1-an"
    error_message = "最長の入力でバケット名が形式どおりでない: ${aws_s3_bucket.site.bucket}"
  }

  assert {
    condition     = length(aws_s3_bucket.site.bucket) <= 63
    error_message = "バケット名が 63 文字を超えている（${length(aws_s3_bucket.site.bucket)} 文字）"
  }
}

run "naming_環境がdevでも形式どおり" {
  command = plan

  variables {
    environment = "dev"
  }

  assert {
    condition     = aws_s3_bucket.site.bucket == "shirabe-dev-s3-site-123456789012-ap-northeast-1-an"
    error_message = "dev のバケット名が形式どおりでない: ${aws_s3_bucket.site.bucket}"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.site.name == "shirabe-dev-cloudfront-site"
    error_message = "dev の OAC の名前が形式どおりでない"
  }
}

run "naming_環境がstgでも形式どおり" {
  command = plan

  variables {
    environment = "stg"
  }

  assert {
    condition     = aws_s3_bucket.site.bucket == "shirabe-stg-s3-site-123456789012-ap-northeast-1-an"
    error_message = "stg のバケット名が形式どおりでない: ${aws_s3_bucket.site.bucket}"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.site.name == "shirabe-stg-cloudfront-site"
    error_message = "stg の OAC の名前が形式どおりでない"
  }
}
