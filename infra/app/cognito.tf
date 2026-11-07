# 共有のログイン（Google だけ。受け取るのは sub だけ）。設定は docs/adr/0035-share-by-unguessable-url-with-google-login.md。
# Google のクライアント ID が未設定のあいだは何も作らない。

locals {
  # 共有の部品を作るかどうか。3つの変数がそろっていることは google_client_id の validation が保証する
  sharing_enabled = var.google_client_id != ""

  cognito_name = "${var.project_name}-${var.environment}-cognito"

  # ホステッド UI のドメインの URL。画面のビルドと CSP（connect-src）に渡す。共有の部品が無いときは空文字
  cognito_domain_url = local.sharing_enabled ? "https://${var.cognito_domain_prefix}.auth.${data.aws_region.current.region}.amazoncognito.com" : ""

  # ログイン後・ログアウト後に戻る先。公開 URL（CloudFront のドメインと独自ドメイン）の /
  cognito_return_urls = [for host in concat([aws_cloudfront_distribution.site.domain_name], var.domain_names) : "https://${host}/"]
}

# メールをユーザー名にする設定や必須の属性は、作った後に変えられないので置かない
resource "aws_cognito_user_pool" "users" {
  count = local.sharing_enabled ? 1 : 0

  name           = "${local.cognito_name}-users"
  user_pool_tier = "LITE"
  tags           = local.tags

  # 自前のサインアップは使わない。ユーザーは Google 経由でだけ入る
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_identity_provider" "google" {
  count = local.sharing_enabled ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.users[0].id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid"
  }

  # メール・名前は受け取らない。Cognito のユーザー名に Google の sub を入れる
  attribute_mapping = {
    username = "sub"
  }
}

# 画面用の公開クライアント。PKCE に Terraform の設定項目は無く、シークレットなし＋認可コードフローで画面側が付ける
resource "aws_cognito_user_pool_client" "web" {
  count = local.sharing_enabled ? 1 : 0

  name         = "${local.cognito_name}-web"
  user_pool_id = aws_cognito_user_pool.users[0].id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid"]

  # IdP の作成後に参照させる（先に参照すると Cognito に拒まれる）
  supported_identity_providers = [aws_cognito_identity_provider.google[0].provider_name]

  callback_urls = local.cognito_return_urls
  logout_urls   = local.cognito_return_urls

  # ID とパスワードでの直接認証は許さない。更新トークンだけ
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
}

# managed_login_version = 1 は従来のホステッド UI（新しいマネージドログインは Lite プランでは使わない）
resource "aws_cognito_user_pool_domain" "auth" {
  count = local.sharing_enabled ? 1 : 0

  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.users[0].id
  managed_login_version = 1
}
