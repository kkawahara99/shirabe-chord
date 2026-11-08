# レスポンスヘッダポリシー（セキュリティヘッダ）の各値を確かめる。

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

run "headers_HSTS" {
  command = plan

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].strict_transport_security).access_control_max_age_sec == 31536000
    error_message = "HSTS の max-age が 31536000 でない"
  }

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].strict_transport_security).include_subdomains == true
    error_message = "HSTS の includeSubDomains が有効でない"
  }

  # preload はサブドメインを含めた恒久的な登録になり戻しにくいので付けない
  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].strict_transport_security).preload == false
    error_message = "HSTS の preload が付いている"
  }
}

run "headers_nosniff_フレーム禁止_リファラ" {
  command = plan

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_type_options).override == true
    error_message = "X-Content-Type-Options（nosniff）が付いていない"
  }

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].frame_options).frame_option == "DENY"
    error_message = "X-Frame-Options が DENY でない"
  }

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].referrer_policy).referrer_policy == "strict-origin-when-cross-origin"
    error_message = "Referrer-Policy が strict-origin-when-cross-origin でない"
  }
}

run "headers_CSP" {
  command = plan

  # pnpm --filter web build の成果物（apps/web/dist）で確かめた内容:
  #  - index.html は、同じオリジンの /assets/*.js（<script type="module" src>）・/assets/*.css（<link rel="stylesheet">）・/favicon.svg（<link rel="icon">）だけを読み込む。
  #  - インラインの <script>・<style> は無い。外部のオリジン・data: URI・フォント・画像の読み込みも無い。
  #  - privacy.html は、同じオリジンの /privacy.css・/favicon.svg だけを読み込み、インラインは無い（apps/web/src/privacy-page.test.ts が守る）。
  #  - JS 内の http:// は XML の名前空間の文字列で、取得はされない。
  # 画面の作りを変えたとき（外部フォントや CDN の追加など）は、この値を見直す。
  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy == "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    error_message = "CSP が固定値と違う"
  }
}

run "headers_すべてoverrideで上書きする" {
  command = plan

  assert {
    condition = alltrue([
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].strict_transport_security).override,
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_type_options).override,
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].frame_options).override,
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].referrer_policy).override,
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).override,
    ])
    error_message = "override が true でないヘッダがある"
  }
}
