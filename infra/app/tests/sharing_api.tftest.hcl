# 共有の API Gateway（HTTP API）を確かめる。スロットリングの値と、経路ごとの認可の有無が要点。
# JWT の検証そのものと、スロットリングの実効はモックでは確かめられない。適用後（#82）に実際の呼び出しで確かめる。

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

run "HTTPAPI_プロトコルHTTP_タグ" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_api.api[0].protocol_type == "HTTP"
    error_message = "プロトコルが HTTP でない"
  }

  assert {
    condition     = aws_apigatewayv2_api.api[0].tags["Project"] == "shirabe-chord"
    error_message = "API に Project タグが付いていない"
  }
}

run "ステージ_default_自動デプロイ_全体のスロットリング" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_stage.api[0].name == "$default"
    error_message = "ステージ名が $default でない（パスにステージ名が付く）"
  }

  assert {
    condition     = aws_apigatewayv2_stage.api[0].auto_deploy == true
    error_message = "自動デプロイが有効でない"
  }

  assert {
    condition     = aws_apigatewayv2_stage.api[0].default_route_settings[0].throttling_rate_limit == 20 && aws_apigatewayv2_stage.api[0].default_route_settings[0].throttling_burst_limit == 40
    error_message = "ステージ全体のスロットリングが rate 20・burst 40 でない"
  }

  assert {
    condition     = aws_apigatewayv2_stage.api[0].tags["Project"] == "shirabe-chord"
    error_message = "ステージに Project タグが付いていない"
  }
}

run "共有作成だけ個別のスロットリング" {
  command = plan

  assert {
    condition     = length(aws_apigatewayv2_stage.api[0].route_settings) == 1
    error_message = "経路ごとのスロットリングが 1 件だけでない"
  }

  assert {
    condition     = [for r in aws_apigatewayv2_stage.api[0].route_settings : r.route_key] == ["POST /api/shares"]
    error_message = "個別のスロットリングが POST /api/shares だけに付いていない"
  }

  assert {
    condition = alltrue([
      for r in aws_apigatewayv2_stage.api[0].route_settings :
      r.throttling_rate_limit == 2 && r.throttling_burst_limit == 5
    ])
    error_message = "POST /api/shares のスロットリングが rate 2・burst 5 でない"
  }
}

run "経路_作成と一覧と削除はJWT認可あり" {
  command = plan

  assert {
    condition = alltrue([
      for key in ["POST /api/shares", "GET /api/shares", "DELETE /api/shares/{id}"] :
      aws_apigatewayv2_route.api[key].authorization_type == "JWT"
    ])
    error_message = "作成・一覧・削除のどれかに JWT 認可が付いていない"
  }

  assert {
    condition = alltrue([
      for key in ["POST /api/shares", "GET /api/shares", "DELETE /api/shares/{id}"] :
      aws_apigatewayv2_route.api[key].authorizer_id == "authexample"
    ])
    error_message = "作成・一覧・削除のどれかが Cognito の認可を指していない"
  }
}

run "経路_閲覧は認可なし" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_route.api["GET /api/shares/{id}"].authorization_type == "NONE"
    error_message = "閲覧に認可が付いている（URL を知る人は誰でも見られる）"
  }

  assert {
    condition     = aws_apigatewayv2_route.api["GET /api/shares/{id}"].authorizer_id == null
    error_message = "閲覧に認可の ID が付いている"
  }

  assert {
    condition     = toset(keys(aws_apigatewayv2_route.api)) == toset(["POST /api/shares", "GET /api/shares", "GET /api/shares/{id}", "DELETE /api/shares/{id}"])
    error_message = "経路が apps/api のハンドラの 4 つと一致しない"
  }
}

run "認可の設定_Cognitoのissuer_audience_Authorizationヘッダー" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_authorizer.cognito[0].authorizer_type == "JWT"
    error_message = "認可の種類が JWT でない"
  }

  assert {
    condition     = aws_apigatewayv2_authorizer.cognito[0].jwt_configuration[0].issuer == "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_EXAMPLE"
    error_message = "issuer が Cognito のユーザープールでない"
  }

  assert {
    condition     = aws_apigatewayv2_authorizer.cognito[0].jwt_configuration[0].audience == toset(["exampleclientid"])
    error_message = "audience が画面用のアプリクライアントでない"
  }

  assert {
    condition     = aws_apigatewayv2_authorizer.cognito[0].identity_sources == toset(["$request.header.Authorization"])
    error_message = "トークンの読み取り元が Authorization ヘッダーでない"
  }
}

run "統合_Lambdaプロキシ_ペイロード2" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_integration.api[0].integration_type == "AWS_PROXY"
    error_message = "統合が Lambda プロキシでない"
  }

  assert {
    condition     = aws_apigatewayv2_integration.api[0].payload_format_version == "2.0"
    error_message = "ペイロードのバージョンが 2.0 でない（apps/api は 2.0 の形を読む）"
  }

  assert {
    condition     = aws_apigatewayv2_integration.api[0].integration_method == "POST"
    error_message = "Lambda の呼び出しメソッドが POST でない"
  }
}

run "Lambda権限_このAPIからだけ呼べる" {
  command = plan

  assert {
    condition     = aws_lambda_permission.api[0].principal == "apigateway.amazonaws.com" && aws_lambda_permission.api[0].action == "lambda:InvokeFunction"
    error_message = "API Gateway からの呼び出しを許していない"
  }

  assert {
    condition     = aws_lambda_permission.api[0].source_arn == "arn:aws:execute-api:ap-northeast-1:123456789012:apiexample/*/*"
    error_message = "呼び出し元がこの API に絞られていない"
  }
}
