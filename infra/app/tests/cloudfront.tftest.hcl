# ディストリビューションと OAC の構成、独自ドメインの有無による切り替えを確かめる。
# ID・ARN・ドメイン名などの計算値は plan で不明なので、override_resource で固定している。

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

run "cloudfront_OACを使いS3のRESTエンドポイントを向く" {
  command = plan

  assert {
    condition     = aws_cloudfront_origin_access_control.site.signing_protocol == "sigv4"
    error_message = "OAC の署名が SigV4 でない"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.site.signing_behavior == "always"
    error_message = "OAC の署名が always でない"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.site.origin_access_control_origin_type == "s3"
    error_message = "OAC の対象が s3 でない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.origin).origin_access_control_id == "OACEXAMPLE"
    error_message = "オリジンが OAC を使っていない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.origin).domain_name == "shirabe-prd-s3-site-123456789012-ap-northeast-1-an.s3.ap-northeast-1.amazonaws.com"
    error_message = "オリジンがサイト用バケットの S3 REST エンドポイントを向いていない"
  }
}

run "cloudfront_配信の基本設定" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.site.default_root_object == "index.html"
    error_message = "default_root_object が index.html でない"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "HTTP が HTTPS へリダイレクトされない"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].compress
    error_message = "圧縮が有効でない"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.price_class == "PriceClass_200"
    error_message = "price_class が PriceClass_200 でない"
  }

  # AWS 管理の CachingOptimized の固定 ID
  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].cache_policy_id == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    error_message = "キャッシュポリシーが CachingOptimized の固定 ID でない"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].response_headers_policy_id == "RHPEXAMPLE"
    error_message = "レスポンスヘッダポリシーがディストリビューションに付いていない"
  }
}

run "cloudfront_ドメイン指定なしはCloudFront既定の証明書" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.site.aliases) == 0
    error_message = "ドメイン未指定なのに aliases が入っている"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).cloudfront_default_certificate == true
    error_message = "CloudFront 既定の証明書を使っていない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).acm_certificate_arn == null
    error_message = "ドメイン未指定なのに ACM 証明書が入っている"
  }
}

run "cloudfront_ドメイン指定ありはaliasesとACM証明書" {
  command = plan

  variables {
    domain_names        = ["chord.example.com"]
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.aliases == toset(["chord.example.com"])
    error_message = "aliases に指定したドメインが入っていない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).acm_certificate_arn == "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
    error_message = "指定した ACM 証明書を使っていない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).ssl_support_method == "sni-only"
    error_message = "ssl_support_method が sni-only でない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).minimum_protocol_version == "TLSv1.2_2021"
    error_message = "最小 TLS が TLSv1.2_2021 でない"
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.viewer_certificate).cloudfront_default_certificate != true
    error_message = "ドメイン指定ありなのに CloudFront 既定の証明書を使っている"
  }
}
