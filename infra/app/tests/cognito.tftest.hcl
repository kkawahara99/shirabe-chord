# 共有の部品（Cognito）を確かめる。Google のクライアント ID が設定されたときだけ作る（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
# モックでは確かめられない点は、適用前（#82）に実際の plan と画面から確かめる:
#   - プロバイダ側の検証（user_pool_tier と managed_login_version の組み合わせ、ドメインの接頭辞の重複など）
#   - 適用後も identities 属性が残り、メール・名前が無いこと
#   - PKCE の実動作（Terraform に設定項目は無い。シークレットなしの公開クライアント＋認可コードフローで、画面側が code_challenge を付ける）
#   - 適用後の 2 回目の plan で、IdP の provider_details に差分が出ないこと（Cognito が URL 類を自動で足す場合は lifecycle.ignore_changes で受ける）
#   - Google 側の OAuth クライアントの設定（承認済みのリダイレクト URI に <ドメイン URL>/oauth2/idpresponse を入れる）

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
  # plan では ID・ARN・ドメイン名などの計算値が不明で、それに頼る assert が unknown になる。架空の値で固定する
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
  # 共有の API・配信も一緒に作られるので、plan で不明な値を固定する
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

# 設定したときの値。未設定の run は、これを空に戻す
variables {
  google_client_id      = "example.apps.googleusercontent.com"
  google_client_secret  = "example-secret"
  cognito_domain_prefix = "shirabe-example"
}

# --- 未設定 ---

run "未設定_共有の部品を何も作らない" {
  command = plan
  variables {
    google_client_id      = ""
    google_client_secret  = ""
    cognito_domain_prefix = ""
  }
  assert {
    condition = (
      length(aws_cognito_user_pool.users) == 0 &&
      length(aws_cognito_identity_provider.google) == 0 &&
      length(aws_cognito_user_pool_client.web) == 0 &&
      length(aws_cognito_user_pool_domain.auth) == 0
    )
    error_message = "未設定なのに Cognito の部品を作ろうとしている"
  }
}

run "未設定_出力は空文字" {
  command = plan
  variables {
    google_client_id      = ""
    google_client_secret  = ""
    cognito_domain_prefix = ""
  }
  assert {
    condition     = output.cognito_domain_url == "" && output.cognito_client_id == ""
    error_message = "未設定なのに出力が空文字でない"
  }
}

# --- ユーザープール ---

run "ユーザープール_Liteプラン_タグ付き" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.users[0].user_pool_tier == "LITE"
    error_message = "user_pool_tier が LITE でない"
  }
  assert {
    condition     = aws_cognito_user_pool.users[0].name == "shirabe-prd-cognito-users"
    error_message = "ユーザープールの名前が <プロジェクト>-<環境>-cognito-users でない"
  }
  assert {
    condition     = aws_cognito_user_pool.users[0].tags["Project"] == "shirabe-chord"
    error_message = "ユーザープールに Project タグが付いていない"
  }
}

run "ユーザープール_必須の属性もメールのユーザー名も置かない" {
  command = plan
  assert {
    condition     = length(aws_cognito_user_pool.users[0].schema) == 0
    error_message = "必須の属性（schema）を置いている。作った後は変えられない"
  }
  assert {
    condition     = length(coalesce(aws_cognito_user_pool.users[0].username_attributes, [])) == 0
    error_message = "メールなどをユーザー名にする設定がある。作った後は変えられない"
  }
  assert {
    condition     = length(coalesce(aws_cognito_user_pool.users[0].auto_verified_attributes, [])) == 0
    error_message = "メールなどの確認の設定がある"
  }
}

run "ユーザープール_自前のサインアップは無効" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.users[0].admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "管理者以外もユーザーを作れる設定になっている"
  }
}

# --- Google の IdP ---

run "GoogleIdP_Googleだけで_マッピングはsubのみ" {
  command = plan
  assert {
    condition     = aws_cognito_identity_provider.google[0].provider_type == "Google" && aws_cognito_identity_provider.google[0].provider_name == "Google"
    error_message = "IdP が Google でない"
  }
  assert {
    condition     = aws_cognito_identity_provider.google[0].provider_details["authorize_scopes"] == "openid"
    error_message = "Google に要求するスコープが openid だけでない"
  }
  assert {
    condition     = aws_cognito_identity_provider.google[0].attribute_mapping == tomap({ username = "sub" })
    error_message = "属性のマッピングが sub だけでない（メール・名前を要求している）"
  }
}

# --- アプリクライアント ---

run "クライアント_シークレットなしの公開クライアント" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web[0].generate_secret == false
    error_message = "クライアントシークレットを作っている。画面は公開クライアントにする"
  }
}

run "クライアント_認可コードだけ_openidだけ" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web[0].allowed_oauth_flows_user_pool_client == true
    error_message = "OAuth のフローが有効でない"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].allowed_oauth_flows == toset(["code"])
    error_message = "OAuth のフローが認可コードだけでない（implicit などを許している）"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].allowed_oauth_scopes == toset(["openid"])
    error_message = "OAuth のスコープが openid だけでない"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].explicit_auth_flows == toset(["ALLOW_REFRESH_TOKEN_AUTH"])
    error_message = "ID とパスワードなどの直接認証を許している"
  }
}

run "クライアント_サインインできるIdPはGoogleだけ" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web[0].supported_identity_providers == toset(["Google"])
    error_message = "Google 以外のサインイン（Cognito 自前を含む）を許している"
  }
}

run "クライアント_戻り先は公開URLの_スラッシュ" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web[0].callback_urls == toset(["https://d111111abcdef8.cloudfront.net/"])
    error_message = "ログイン後の戻り先が CloudFront のドメインの / だけでない"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].logout_urls == toset(["https://d111111abcdef8.cloudfront.net/"])
    error_message = "ログアウト後の戻り先が CloudFront のドメインの / だけでない"
  }
}

run "クライアント_独自ドメイン指定時はそのドメインの_スラッシュも戻り先" {
  command = plan
  variables {
    domain_names        = ["chord.example.com"]
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].callback_urls == toset(["https://d111111abcdef8.cloudfront.net/", "https://chord.example.com/"])
    error_message = "ログイン後の戻り先に独自ドメインの / が無い"
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].logout_urls == toset(["https://d111111abcdef8.cloudfront.net/", "https://chord.example.com/"])
    error_message = "ログアウト後の戻り先に独自ドメインの / が無い"
  }
}

# --- ドメイン ---

run "ドメイン_接頭辞を使い_従来のホステッドUI" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_domain.auth[0].domain == "shirabe-example"
    error_message = "ドメインの接頭辞が変数と違う"
  }
  assert {
    condition     = aws_cognito_user_pool_domain.auth[0].managed_login_version == 1
    error_message = "従来のホステッド UI（managed_login_version = 1）でない"
  }
}

# --- 出力 ---

run "出力_ドメインURLはhttpsで始まりクライアントIDを返す" {
  command = plan
  assert {
    condition     = output.cognito_domain_url == "https://shirabe-example.auth.ap-northeast-1.amazoncognito.com"
    error_message = "cognito_domain_url が https://<接頭辞>.auth.<リージョン>.amazoncognito.com でない"
  }
  assert {
    condition     = output.cognito_client_id == "exampleclientid"
    error_message = "cognito_client_id がアプリクライアントの ID と違う"
  }
}
