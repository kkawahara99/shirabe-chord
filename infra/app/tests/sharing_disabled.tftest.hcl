# 共有の部品を使わないとき（Google のクライアント ID が未設定）は、API・データ・配信の拡張を何も作らず、
# 既存の CloudFront・CSP が今までと同じことを確かめる（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。

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

run "未設定_共有のAPI部品と拡張を何も作らない" {
  command = plan
  variables {
    google_client_id      = ""
    google_client_secret  = ""
    cognito_domain_prefix = ""
  }

  assert {
    condition = (
      length(aws_dynamodb_table.shares) == 0 &&
      length(aws_lambda_function.api) == 0 &&
      length(aws_cloudwatch_log_group.api) == 0 &&
      length(aws_apigatewayv2_api.api) == 0 &&
      length(aws_apigatewayv2_stage.api) == 0 &&
      length(aws_apigatewayv2_authorizer.cognito) == 0 &&
      length(aws_apigatewayv2_integration.api) == 0 &&
      length(aws_apigatewayv2_route.api) == 0 &&
      length(aws_lambda_permission.api) == 0 &&
      length(data.archive_file.api) == 0 &&
      length(aws_cloudfront_function.spa) == 0 &&
      length(aws_cloudfront_response_headers_policy.site_noindex) == 0
    )
    error_message = "未設定なのに共有の部品を作ろうとしている"
  }
}

run "未設定_CSPと振る舞いとFunctionが今と同じ" {
  command = plan
  variables {
    google_client_id      = ""
    google_client_secret  = ""
    cognito_domain_prefix = ""
  }

  assert {
    condition     = one(aws_cloudfront_response_headers_policy.site.security_headers_config[0].content_security_policy).content_security_policy == "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    error_message = "未設定なのに CSP が今の値と違う"
  }

  assert {
    condition     = length(aws_cloudfront_distribution.site.ordered_cache_behavior) == 0
    error_message = "未設定なのに追加の振る舞いがある"
  }

  assert {
    condition     = length(aws_cloudfront_distribution.site.origin) == 1
    error_message = "未設定なのにオリジンが 2 つ以上ある"
  }

  assert {
    condition     = length(aws_cloudfront_distribution.site.default_cache_behavior[0].function_association) == 0
    error_message = "未設定なのに既定の振る舞いに Function が付いている"
  }
}
