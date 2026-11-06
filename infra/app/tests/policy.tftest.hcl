# バケットポリシー（2文）を確かめる。ディストリビューションの ARN は plan で不明なので、override_resource で固定している。

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

run "policy_TLS以外を拒否する文" {
  command = plan

  assert {
    condition     = aws_s3_bucket_policy.site.bucket == aws_s3_bucket.site.bucket
    error_message = "ポリシーがサイト用バケットに付いていない"
  }

  assert {
    condition     = length(jsondecode(aws_s3_bucket_policy.site.policy).Statement) == 2
    error_message = "ポリシーの Statement がちょうど2つでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Effect == "Deny"
    error_message = "1文目の Effect が Deny でない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Principal == "*"
    error_message = "1文目の Principal が * でない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Action == "s3:*"
    error_message = "1文目の Action が s3:* でない"
  }

  assert {
    condition = (
      toset(jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Resource)
      == toset([
        "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an",
        "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an/*",
      ])
    )
    error_message = "1文目の Resource がバケットとバケット配下の2つでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "1文目の条件が aws:SecureTransport = false でない"
  }
}

run "policy_このCloudFrontからのGetObjectだけ許可する文" {
  command = plan

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[1].Effect == "Allow"
    error_message = "2文目の Effect が Allow でない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[1].Principal == { Service = "cloudfront.amazonaws.com" }
    error_message = "2文目の Principal が cloudfront.amazonaws.com のサービスでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[1].Action == "s3:GetObject"
    error_message = "2文目の Action が s3:GetObject だけでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[1].Resource == "arn:aws:s3:::shirabe-prd-s3-site-123456789012-ap-northeast-1-an/*"
    error_message = "2文目の Resource がバケット配下だけでない"
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.site.policy).Statement[1].Condition
      == { StringEquals = { "AWS:SourceArn" = "arn:aws:cloudfront::123456789012:distribution/EDISTEXAMPLE" } }
    )
    error_message = "2文目の条件が、このディストリビューションの ARN への StringEquals の AWS:SourceArn になっていない"
  }
}
