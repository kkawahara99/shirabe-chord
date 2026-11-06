# 出力を確かめる。バケット名・ディストリビューション ID は sensitive（アカウントIDが入るため。terraform output -raw で取り出す）。

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

run "outputs_バケット名とディストリビューションIDが実際の値と一致" {
  command = plan

  assert {
    condition     = output.site_bucket_name == aws_s3_bucket.site.bucket
    error_message = "site_bucket_name の出力が実際のバケット名と違う"
  }

  assert {
    condition     = output.distribution_id == "EDISTEXAMPLE"
    error_message = "distribution_id の出力が実際のディストリビューション ID と違う"
  }
}

run "outputs_ドメイン名が実際のドメイン名と一致" {
  command = plan

  assert {
    condition     = output.distribution_domain_name == "d111111abcdef8.cloudfront.net"
    error_message = "distribution_domain_name の出力が実際のドメイン名と違う"
  }
}
