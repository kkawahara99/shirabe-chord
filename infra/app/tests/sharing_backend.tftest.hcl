# 共有の DynamoDB・Lambda・ロググループと、その名前を確かめる（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
# 名前の文字列は infra/bootstrap（#78）の実行ロールの許可と同じ固定のもの。双方のテストが同じ文字列を確かめる。
# プロバイダ側の検証（ランタイム名など）はモックでは走らない。適用前（#82）に実際の plan で確かめる。

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

run "テーブル_主キーid_オンデマンド_暗号化は既定のまま_タグ" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.shares[0].hash_key == "id" && aws_dynamodb_table.shares[0].range_key == null
    error_message = "主キーが id のみでない"
  }

  assert {
    condition     = [for a in aws_dynamodb_table.shares[0].attribute : a.type if a.name == "id"] == ["S"]
    error_message = "id が文字列型でない"
  }

  assert {
    condition     = aws_dynamodb_table.shares[0].billing_mode == "PAY_PER_REQUEST"
    error_message = "オンデマンド課金でない"
  }

  # 既定の暗号化（AWS 所有のキー）のままにする。server_side_encryption を書くと KMS を使う設定になる
  assert {
    condition     = length(aws_dynamodb_table.shares[0].server_side_encryption) == 0
    error_message = "暗号化の設定を明示している（既定のままにする）"
  }

  assert {
    condition     = aws_dynamodb_table.shares[0].tags["Project"] == "shirabe-chord"
    error_message = "テーブルに Project タグが付いていない"
  }
}

run "所有者索引_owner-index_ownerSubとcreatedAt_titleとchordCountだけ写す" {
  command = plan

  assert {
    condition     = length(aws_dynamodb_table.shares[0].global_secondary_index) == 1
    error_message = "索引が 1 つでない"
  }

  assert {
    condition     = [for i in aws_dynamodb_table.shares[0].global_secondary_index : i.name] == ["owner-index"]
    error_message = "索引の名前が owner-index でない"
  }

  assert {
    condition     = [for i in aws_dynamodb_table.shares[0].global_secondary_index : i.hash_key] == ["ownerSub"]
    error_message = "索引のパーティションキーが ownerSub でない"
  }

  assert {
    condition     = [for i in aws_dynamodb_table.shares[0].global_secondary_index : i.range_key] == ["createdAt"]
    error_message = "索引の並びのキーが createdAt でない"
  }

  # id は主キーなので索引に必ず入る。残りの一覧の項目（タイトル・コード数）だけを写す
  assert {
    condition     = [for i in aws_dynamodb_table.shares[0].global_secondary_index : i.projection_type] == ["INCLUDE"]
    error_message = "索引の写し方が INCLUDE でない（本文まで写すと費用が増える）"
  }

  assert {
    condition     = one([for i in aws_dynamodb_table.shares[0].global_secondary_index : i.non_key_attributes]) == toset(["chordCount", "title"])
    error_message = "索引に写す項目が chordCount・title だけでない"
  }

  assert {
    condition     = toset([for a in aws_dynamodb_table.shares[0].attribute : a.name]) == toset(["id", "ownerSub", "createdAt"])
    error_message = "属性の定義が id・ownerSub・createdAt だけでない"
  }
}

run "Lambda_nodejs24_256MB_10秒_ハンドラ_実行ロール_タグ" {
  command = plan

  assert {
    condition     = aws_lambda_function.api[0].runtime == "nodejs24.x"
    error_message = "ランタイムが nodejs24.x でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].memory_size == 256
    error_message = "メモリが 256MB でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].timeout == 10
    error_message = "タイムアウトが 10 秒でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].handler == "index.handler"
    error_message = "ハンドラが index.handler でない（ビルド成果物は index.mjs の handler）"
  }

  assert {
    condition     = aws_lambda_function.api[0].role == "arn:aws:iam::123456789012:role/shirabe-prd-iam-lambda-api"
    error_message = "実行ロールが infra/bootstrap の固定の名前の ARN でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].tags["Project"] == "shirabe-chord"
    error_message = "関数に Project タグが付いていない"
  }
}

run "Lambda環境変数_テーブル名_索引名_SSM名_hostname" {
  command = plan

  # 独自ドメインが無ければ CloudFront のドメインが、Turnstile の返す hostname になる
  assert {
    # map と object は == で等しくならないので、キーを並べ替えて文字列にして比べる
    condition = jsonencode(aws_lambda_function.api[0].environment[0].variables) == jsonencode({
      SHARES_TABLE               = "shirabe-prd-dynamodb-shares"
      SHARES_OWNER_INDEX         = "owner-index"
      TURNSTILE_SECRET_PARAMETER = "/shirabe/prd/turnstile-secret"
      TURNSTILE_HOSTNAME         = "d111111abcdef8.cloudfront.net"
    })
    error_message = "環境変数が想定と違う: ${jsonencode(aws_lambda_function.api[0].environment[0].variables)}"
  }
}

run "Lambda環境変数_独自ドメインありならその先頭がhostname" {
  command = plan

  variables {
    domain_names        = ["chord.example.com", "www.chord.example.com"]
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = aws_lambda_function.api[0].environment[0].variables["TURNSTILE_HOSTNAME"] == "chord.example.com"
    error_message = "独自ドメインがあるのに hostname がその先頭でない"
  }
}

run "ロググループ_名前_保持30日_タグ" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.api[0].name == "/aws/lambda/shirabe-prd-lambda-api"
    error_message = "ロググループの名前が /aws/lambda/<関数名> でない"
  }

  assert {
    condition     = aws_cloudwatch_log_group.api[0].retention_in_days == 30
    error_message = "保持期間が 30 日でない"
  }

  assert {
    condition     = aws_cloudwatch_log_group.api[0].tags["Project"] == "shirabe-chord"
    error_message = "ロググループに Project タグが付いていない"
  }
}

run "zip_archive_fileが入力パスのファイルを固めて関数に渡す" {
  command = plan

  variables {
    api_bundle_path = "custom/path/index.mjs"
  }

  assert {
    condition     = data.archive_file.api[0].source_file == "custom/path/index.mjs"
    error_message = "zip の入力が api_bundle_path でない"
  }

  assert {
    condition     = data.archive_file.api[0].type == "zip"
    error_message = "zip でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].filename == data.archive_file.api[0].output_path && aws_lambda_function.api[0].source_code_hash == "ZXhhbXBsZQ=="
    error_message = "関数が zip とそのハッシュを使っていない"
  }
}

run "固定の名前_既定値で指定の文字列" {
  command = plan

  assert {
    condition     = aws_lambda_function.api[0].function_name == "shirabe-prd-lambda-api"
    error_message = "関数名が shirabe-prd-lambda-api でない"
  }

  assert {
    condition     = aws_cloudwatch_log_group.api[0].name == "/aws/lambda/shirabe-prd-lambda-api"
    error_message = "ロググループ名が /aws/lambda/shirabe-prd-lambda-api でない"
  }

  assert {
    condition     = aws_cloudfront_function.spa[0].name == "shirabe-prd-cloudfront-spa"
    error_message = "CloudFront Function の名前が shirabe-prd-cloudfront-spa でない"
  }

  assert {
    condition     = aws_dynamodb_table.shares[0].name == "shirabe-prd-dynamodb-shares"
    error_message = "テーブル名が shirabe-prd-dynamodb-shares でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].role == "arn:aws:iam::123456789012:role/shirabe-prd-iam-lambda-api"
    error_message = "実行ロールの ARN が .../role/shirabe-prd-iam-lambda-api でない"
  }

  assert {
    condition     = aws_lambda_function.api[0].environment[0].variables["TURNSTILE_SECRET_PARAMETER"] == "/shirabe/prd/turnstile-secret"
    error_message = "SSM パラメータ名が /shirabe/prd/turnstile-secret でない"
  }
}

run "固定の名前_プロジェクト名と環境に追随" {
  command = plan

  variables {
    project_name = "abcdefghij"
    environment  = "dev"
  }

  assert {
    condition     = aws_lambda_function.api[0].function_name == "abcdefghij-dev-lambda-api"
    error_message = "関数名がプロジェクト名・環境名に追随していない"
  }

  assert {
    condition     = aws_lambda_function.api[0].role == "arn:aws:iam::123456789012:role/abcdefghij-dev-iam-lambda-api"
    error_message = "実行ロールの ARN が追随していない"
  }

  assert {
    condition     = aws_dynamodb_table.shares[0].name == "abcdefghij-dev-dynamodb-shares"
    error_message = "テーブル名が追随していない"
  }

  assert {
    condition     = aws_cloudfront_function.spa[0].name == "abcdefghij-dev-cloudfront-spa"
    error_message = "CloudFront Function の名前が追随していない"
  }

  assert {
    condition     = aws_lambda_function.api[0].environment[0].variables["TURNSTILE_SECRET_PARAMETER"] == "/abcdefghij/dev/turnstile-secret"
    error_message = "SSM パラメータ名が追随していない"
  }
}

run "名前の長さ_関数名とロール名が64文字以内" {
  command = plan

  variables {
    project_name = "abcdefghij"
    environment  = "prd"
  }

  assert {
    condition     = length(aws_lambda_function.api[0].function_name) <= 64
    error_message = "関数名が 64 文字を超えている"
  }

  assert {
    condition     = length(element(split("/", aws_lambda_function.api[0].role), 1)) <= 64
    error_message = "実行ロール名が 64 文字を超えている"
  }
}
