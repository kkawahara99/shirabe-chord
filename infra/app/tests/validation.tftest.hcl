# 入力変数の validation を確かめる。terraform test には性質テストの仕組みが無いため、境界値の点で確かめる。

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
  # 共有の部品を作る run では API も一緒に作られるので、plan で不明な値を固定する
  override_resource {
    target          = aws_apigatewayv2_api.api
    override_during = plan
    values = {
      api_endpoint  = "https://apiexample.execute-api.ap-northeast-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:ap-northeast-1:123456789012:apiexample"
    }
  }
}

# zip の入力（ビルド成果物）が無くても動くよう、差し替える
mock_provider "archive" {
  override_data {
    target          = data.archive_file.api
    override_during = plan
    values = {
      output_base64sha256 = "ZXhhbXBsZQ=="
    }
  }
}

# --- project_name ---

run "project_name_正常_2文字は通る" {
  command = plan
  variables {
    project_name = "im"
  }
  assert {
    condition     = var.project_name == "im"
    error_message = "2文字は通る の project_name が通らない"
  }
}

run "project_name_正常_10文字は通る" {
  command = plan
  variables {
    project_name = "abcdefghij"
  }
  assert {
    condition     = var.project_name == "abcdefghij"
    error_message = "10文字は通る の project_name が通らない"
  }
}

run "project_name_正常_数字を含んでも通る" {
  command = plan
  variables {
    project_name = "im2"
  }
  assert {
    condition     = var.project_name == "im2"
    error_message = "数字を含んでも通る の project_name が通らない"
  }
}

run "project_name_異常_大文字は失敗" {
  command = plan
  variables {
    project_name = "Im"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_1文字は失敗" {
  command = plan
  variables {
    project_name = "i"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_11文字は失敗" {
  command = plan
  variables {
    project_name = "abcdefghijk"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_ハイフンは失敗" {
  command = plan
  variables {
    project_name = "im-x"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_空は失敗" {
  command = plan
  variables {
    project_name = ""
  }
  expect_failures = [var.project_name]
}

# --- environment ---

run "environment_正常_dev" {
  command = plan
  variables {
    environment = "dev"
  }
  assert {
    condition     = var.environment == "dev"
    error_message = "dev が通らない"
  }
}

run "environment_正常_stg" {
  command = plan
  variables {
    environment = "stg"
  }
  assert {
    condition     = var.environment == "stg"
    error_message = "stg が通らない"
  }
}

run "environment_正常_prd" {
  command = plan
  variables {
    environment = "prd"
  }
  assert {
    condition     = var.environment == "prd"
    error_message = "prd が通らない"
  }
}

run "environment_異常_prodは失敗" {
  command = plan
  variables {
    environment = "prod"
  }
  expect_failures = [var.environment]
}

run "environment_異常_空は失敗" {
  command = plan
  variables {
    environment = ""
  }
  expect_failures = [var.environment]
}

run "environment_異常_大文字は失敗" {
  command = plan
  variables {
    environment = "PRD"
  }
  expect_failures = [var.environment]
}

# --- region ---

run "region_正常_通常のリージョンは通る" {
  command = plan
  variables {
    region = "us-east-1"
  }
  assert {
    condition     = var.region == "us-east-1"
    error_message = "通常のリージョンが通らない"
  }
}

run "region_異常_me-south-1は失敗" {
  command = plan
  variables {
    region = "me-south-1"
  }
  expect_failures = [var.region]
}

run "region_異常_me-central-1は失敗" {
  command = plan
  variables {
    region = "me-central-1"
  }
  expect_failures = [var.region]
}

# --- domain_names と acm_certificate_arn の組 ---

run "独自ドメイン_正常_両方未指定は通る" {
  command = plan
  assert {
    condition     = length(var.domain_names) == 0 && var.acm_certificate_arn == null
    error_message = "既定値（両方未指定）が通らない"
  }
}

run "独自ドメイン_正常_両方指定は通る" {
  command = plan
  variables {
    domain_names        = ["chord.example.com"]
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  assert {
    condition     = length(var.domain_names) == 1
    error_message = "両方指定が通らない"
  }
}

run "独自ドメイン_異常_domain_namesだけ指定は失敗" {
  command = plan
  variables {
    domain_names = ["chord.example.com"]
  }
  expect_failures = [var.acm_certificate_arn]
}

run "独自ドメイン_異常_acm_certificate_arnだけ指定は失敗" {
  command = plan
  variables {
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  expect_failures = [var.acm_certificate_arn]
}

# --- 証明書のリージョン ---

run "証明書_異常_us-east-1以外は失敗" {
  command = plan
  variables {
    domain_names        = ["chord.example.com"]
    acm_certificate_arn = "arn:aws:acm:ap-northeast-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  expect_failures = [var.acm_certificate_arn]
}

run "証明書_異常_ACMでないARNは失敗" {
  command = plan
  variables {
    domain_names        = ["chord.example.com"]
    acm_certificate_arn = "arn:aws:iam::123456789012:server-certificate/example"
  }
  expect_failures = [var.acm_certificate_arn]
}

# 未指定（null）は us-east-1 の検査の正規表現に渡されず、エラーにならない。null を明示して渡したときも通ることを確かめる
run "証明書_正常_nullを明示してもus-east-1の検査で失敗しない" {
  command = plan
  variables {
    domain_names        = []
    acm_certificate_arn = null
  }
  assert {
    condition     = var.acm_certificate_arn == null
    error_message = "null の acm_certificate_arn が通らない"
  }
}

# --- 共有の変数（google_client_id・google_client_secret・cognito_domain_prefix） ---

run "共有変数_正常_3つとも空は通る" {
  command = plan
  assert {
    condition     = var.google_client_id == "" && var.google_client_secret == "" && var.cognito_domain_prefix == ""
    error_message = "既定値（3つとも空）が通らない"
  }
}

run "共有変数_正常_3つとも設定は通る" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "shirabe-example"
  }
  assert {
    condition     = local.sharing_enabled
    error_message = "3つとも設定したのに sharing_enabled が false"
  }
}

run "共有変数_異常_client_idだけの設定は失敗" {
  command = plan
  variables {
    google_client_id = "example.apps.googleusercontent.com"
  }
  expect_failures = [var.google_client_id]
}

run "共有変数_異常_secretだけの設定は失敗" {
  command = plan
  variables {
    google_client_secret = "example-secret"
  }
  expect_failures = [var.google_client_id]
}

run "共有変数_異常_prefixだけの設定は失敗" {
  command = plan
  variables {
    cognito_domain_prefix = "shirabe-example"
  }
  expect_failures = [var.google_client_id]
}

# --- cognito_domain_prefix ---

run "接頭辞_正常_1文字は通る" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "a"
  }
  assert {
    condition     = var.cognito_domain_prefix == "a"
    error_message = "1文字の接頭辞が通らない"
  }
}

run "接頭辞_正常_63文字は通る" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "a23456789012345678901234567890123456789012345678901234567890123"
  }
  assert {
    condition     = length(var.cognito_domain_prefix) == 63
    error_message = "63文字の接頭辞が通らない"
  }
}

run "接頭辞_異常_大文字は失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "Shirabe"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "接頭辞_異常_アンダースコアは失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "shirabe_x"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "接頭辞_異常_64文字は失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "a234567890123456789012345678901234567890123456789012345678901234"
  }
  expect_failures = [var.cognito_domain_prefix]
}

# Cognito の API は先頭と末尾のハイフンを受け付けない。apply で初めて落ちないよう、変数の検証で止める
run "接頭辞_異常_先頭と末尾のハイフンは失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "-shirabe-"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "接頭辞_異常_cognitoを含むと失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "my-cognito-app"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "接頭辞_異常_awsを含むと失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "myawsapp"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "接頭辞_異常_amazonを含むと失敗" {
  command = plan
  variables {
    google_client_id      = "example.apps.googleusercontent.com"
    google_client_secret  = "example-secret"
    cognito_domain_prefix = "amazon-x"
  }
  expect_failures = [var.cognito_domain_prefix]
}
