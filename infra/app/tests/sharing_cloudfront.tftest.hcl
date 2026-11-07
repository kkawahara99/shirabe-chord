# 共有を使うときの CloudFront（/api/*・/s/*・/mine）と CSP を確かめる（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
# 実際の CloudFront Function の動き（書き換え）は、適用後（#82）に画面から /s/<ID> と /mine を開いて確かめる。

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
    target          = aws_cloudfront_response_headers_policy.site_noindex
    override_during = plan
    values = {
      id = "RHPNOINDEXEXAMPLE"
    }
  }
  override_resource {
    target          = aws_cloudfront_function.spa
    override_during = plan
    values = {
      arn = "arn:aws:cloudfront::123456789012:function/shirabe-prd-cloudfront-spa"
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
  override_resource {
    target          = aws_cognito_user_pool.users
    override_during = plan
    values = {
      id = "ap-northeast-1_EXAMPLE"
    }
  }
  override_resource {
    target          = aws_cognito_user_pool_client.web
    override_during = plan
    values = {
      id = "exampleclientid"
    }
  }
  override_resource {
    target          = aws_apigatewayv2_api.api
    override_during = plan
    values = {
      id            = "apiexample"
      api_endpoint  = "https://apiexample.execute-api.ap-northeast-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:ap-northeast-1:123456789012:apiexample"
    }
  }
  override_resource {
    target          = aws_apigatewayv2_authorizer.cognito
    override_during = plan
    values = {
      id = "authexample"
    }
  }
  override_resource {
    target          = aws_lambda_function.api
    override_during = plan
    values = {
      arn        = "arn:aws:lambda:ap-northeast-1:123456789012:function:shirabe-prd-lambda-api"
      invoke_arn = "arn:aws:apigateway:ap-northeast-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-northeast-1:123456789012:function:shirabe-prd-lambda-api/invocations"
    }
  }
}

# zip は入力パスのファイルから作る。テストではビルド成果物（apps/api/dist）が無くても動くよう、差し替える
mock_provider "archive" {
  override_data {
    target          = data.archive_file.api
    override_during = plan
    values = {
      output_base64sha256 = "ZXhhbXBsZQ=="
    }
  }
}

# 共有の部品を作る設定。使わない run は、これを空に戻す
variables {
  google_client_id      = "example.apps.googleusercontent.com"
  google_client_secret  = "example-secret"
  cognito_domain_prefix = "shirabe-example"
}

run "api振る舞い_キャッシュなし_Authorizationを渡す_Hostは渡さない_全メソッド" {
  command = plan

  assert {
    condition     = length([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b if b.path_pattern == "/api/*"]) == 1
    error_message = "/api/* の振る舞いが 1 つでない"
  }

  # AWS 管理の CachingDisabled の固定 ID
  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.cache_policy_id if b.path_pattern == "/api/*"] == ["4135ea2d-6df8-44a3-9df3-4b5a84be39ad"]
    error_message = "キャッシュポリシーが CachingDisabled の固定 ID でない"
  }

  # AWS 管理の AllViewerExceptHostHeader の固定 ID（Authorization を含む閲覧者のヘッダーを渡し、Host は渡さない）
  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.origin_request_policy_id if b.path_pattern == "/api/*"] == ["b689b0a8-53d0-40ab-baf2-68738e2966ac"]
    error_message = "オリジンリクエストポリシーが AllViewerExceptHostHeader の固定 ID でない"
  }

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : toset(b.allowed_methods) if b.path_pattern == "/api/*"] == [toset(["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"])]
    error_message = "全メソッドを許可していない（POST・DELETE が通らない）"
  }

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.viewer_protocol_policy if b.path_pattern == "/api/*"] == ["https-only"]
    error_message = "/api/* が HTTPS 専用でない（HTTP のまま Authorization を送らせない）"
  }
}

run "apiオリジン_https_APIGatewayのドメイン" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.site.origin) == 2
    error_message = "オリジンが S3 と API の 2 つでない"
  }

  assert {
    condition     = [for o in aws_cloudfront_distribution.site.origin : o.domain_name if o.origin_id == "api"] == ["apiexample.execute-api.ap-northeast-1.amazonaws.com"]
    error_message = "API オリジンのドメインが API Gateway のものでない（https:// を除く）"
  }

  assert {
    condition     = [for o in aws_cloudfront_distribution.site.origin : one(o.custom_origin_config).origin_protocol_policy if o.origin_id == "api"] == ["https-only"]
    error_message = "API オリジンへの接続が https-only でない"
  }

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.target_origin_id if b.path_pattern == "/api/*"] == ["api"]
    error_message = "/api/* が API オリジンを向いていない"
  }
}

run "api振る舞い_画面の書き換えFunctionが掛からない" {
  command = plan

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : length(b.function_association) if b.path_pattern == "/api/*"] == [0]
    error_message = "/api/* に CloudFront Function が付いている（API の応答が index.html になる）"
  }
}

run "s振る舞い_S3オリジン_indexへ書き換えるFunction付き" {
  command = plan

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.target_origin_id if b.path_pattern == "/s/*"] == ["site"]
    error_message = "/s/* が S3 のオリジンを向いていない"
  }

  assert {
    condition     = flatten([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : [for f in b.function_association : f.event_type] if b.path_pattern == "/s/*"]) == ["viewer-request"]
    error_message = "/s/* に viewer-request の Function が付いていない"
  }

  assert {
    condition     = flatten([for b in aws_cloudfront_distribution.site.ordered_cache_behavior : [for f in b.function_association : f.function_arn] if b.path_pattern == "/s/*"]) == ["arn:aws:cloudfront::123456789012:function/shirabe-prd-cloudfront-spa"]
    error_message = "/s/* の Function が spa のものでない"
  }

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : toset(b.allowed_methods) if b.path_pattern == "/s/*"] == [toset(["GET", "HEAD"])]
    error_message = "/s/* が GET・HEAD だけでない"
  }
}

run "既定の振る舞い_mine用に同じFunction" {
  command = plan

  assert {
    condition     = [for f in aws_cloudfront_distribution.site.default_cache_behavior[0].function_association : f.event_type] == ["viewer-request"]
    error_message = "既定の振る舞いに viewer-request の Function が付いていない（/mine が開けない）"
  }

  assert {
    condition     = [for f in aws_cloudfront_distribution.site.default_cache_behavior[0].function_association : f.function_arn] == ["arn:aws:cloudfront::123456789012:function/shirabe-prd-cloudfront-spa"]
    error_message = "既定の振る舞いの Function が spa のものでない"
  }

  # ヘッダポリシーは既定のまま（/mine は noindex にしない）
  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].response_headers_policy_id == "RHPEXAMPLE"
    error_message = "既定の振る舞いのレスポンスヘッダポリシーが変わっている"
  }
}

run "Functionの中身_sと_mineをindexへ書き換え_apiは触らない" {
  command = plan

  assert {
    condition     = aws_cloudfront_function.spa[0].runtime == "cloudfront-js-2.0" && aws_cloudfront_function.spa[0].publish == true
    error_message = "Function のランタイムが cloudfront-js-2.0 でない、または公開されない"
  }

  assert {
    condition = (
      strcontains(aws_cloudfront_function.spa[0].code, "/s/") &&
      strcontains(aws_cloudfront_function.spa[0].code, "/mine") &&
      strcontains(aws_cloudfront_function.spa[0].code, "/index.html")
    )
    error_message = "Function が /s/・/mine を /index.html に書き換える内容でない"
  }

  assert {
    condition     = !strcontains(aws_cloudfront_function.spa[0].code, "/api")
    error_message = "Function が /api に触れている"
  }
}

run "noindex_sとapiに付き_既定には付かない" {
  command = plan

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.response_headers_policy_id if b.path_pattern == "/s/*"] == ["RHPNOINDEXEXAMPLE"]
    error_message = "/s/* に noindex のポリシーが付いていない"
  }

  assert {
    condition     = [for b in aws_cloudfront_distribution.site.ordered_cache_behavior : b.response_headers_policy_id if b.path_pattern == "/api/*"] == ["RHPNOINDEXEXAMPLE"]
    error_message = "/api/* に noindex のポリシーが付いていない"
  }

  assert {
    condition = [
      for i in one(aws_cloudfront_response_headers_policy.site_noindex[0].custom_headers_config).items : "${i.header}: ${i.value} (override=${i.override})"
    ] == ["X-Robots-Tag: noindex (override=true)"]
    error_message = "noindex のポリシーが X-Robots-Tag: noindex だけを付けるものでない"
  }

  assert {
    condition     = length(aws_cloudfront_response_headers_policy.site.custom_headers_config) == 0
    error_message = "既定のポリシーに noindex が付いている（トップ画面が検索に載らなくなる）"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.site_noindex[0].name == "shirabe-prd-cloudfront-site-noindex"
    error_message = "noindex ポリシーの名前が <既定のポリシー名>-noindex でない"
  }
}

run "s用ポリシー_セキュリティヘッダーは既定と同じ" {
  command = plan

  # HSTS・nosniff・X-Frame-Options・Referrer-Policy・CSP の全部を、既定のポリシーと丸ごと比べる。
  # 訪問者が入力した文字を表示するページなので、CSP を外さない
  assert {
    condition     = aws_cloudfront_response_headers_policy.site_noindex[0].security_headers_config == aws_cloudfront_response_headers_policy.site.security_headers_config
    error_message = "/s/* 用のセキュリティヘッダーが既定のポリシーと違う"
  }
}

run "カスタムエラー応答なし" {
  command = plan

  # ディストリビューション全体の応答を画面に替えると、/api の 403・404 まで画面になってしまう
  assert {
    condition     = length(aws_cloudfront_distribution.site.custom_error_response) == 0
    error_message = "カスタムエラー応答がある（/api の 403・404 が画面に替わる）"
  }
}

run "CSP_共有ありの追加は3つだけ" {
  command = plan

  assert {
    condition = (
      one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy ==
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://shirabe-example.auth.ap-northeast-1.amazoncognito.com; frame-src https://challenges.cloudflare.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    )
    error_message = "CSP が想定と違う: ${one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy}"
  }

  # 3 つを除くと、今の CSP（tests/headers.tftest.hcl）に戻る（ほかは広げない）
  assert {
    condition = (
      join("; ", [
        for d in split("; ", one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy) :
        d if !startswith(d, "script-src ") && !startswith(d, "connect-src ") && !startswith(d, "frame-src ")
      ]) == "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    )
    error_message = "script-src・connect-src・frame-src 以外のディレクティブが変わっている"
  }
}

run "CSP_CognitoのURLがプレフィックスとリージョンに追随" {
  command = plan

  variables {
    cognito_domain_prefix = "other-prefix"
  }

  override_data {
    target          = data.aws_region.current
    override_during = plan
    values = {
      region = "us-west-2"
    }
  }

  assert {
    condition     = strcontains(one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy, "connect-src 'self' https://other-prefix.auth.us-west-2.amazoncognito.com;")
    error_message = "connect-src の Cognito の URL がプレフィックス・リージョンに追随していない"
  }
}

run "全リソースにProjectタグ" {
  command = plan

  assert {
    condition = alltrue([
      aws_dynamodb_table.shares[0].tags["Project"] == "shirabe-chord",
      aws_lambda_function.api[0].tags["Project"] == "shirabe-chord",
      aws_cloudwatch_log_group.api[0].tags["Project"] == "shirabe-chord",
      aws_apigatewayv2_api.api[0].tags["Project"] == "shirabe-chord",
      aws_apigatewayv2_stage.api[0].tags["Project"] == "shirabe-chord",
    ])
    error_message = "Project タグが付いていないリソースがある"
  }
}
