variable "project_name" {
  type        = string
  description = "プロジェクト名。リソース名の先頭に付く（docs/adr/0005-resource-naming.md）。"
  default     = "shirabe"

  validation {
    condition     = can(regex("^[a-z0-9]{2,10}$", var.project_name))
    error_message = "project_name は小文字の英数字の2〜10文字にしてください。"
  }
}

variable "environment" {
  type        = string
  description = "環境名。"
  default     = "prd"

  validation {
    condition     = contains(["dev", "stg", "prd"], var.environment)
    error_message = "environment は dev・stg・prd のどれかにしてください。"
  }
}

variable "region" {
  type        = string
  description = "デプロイ先のリージョン。"
  default     = "ap-northeast-1"

  validation {
    # アカウント・リージョン固定の S3 名前空間が使えないリージョン（docs/adr/0005-resource-naming.md）
    condition     = !contains(["me-south-1", "me-central-1"], var.region)
    error_message = "me-south-1 と me-central-1 では S3 のアカウント・リージョン固定の名前空間が使えません。"
  }
}

# 独自ドメインへの切り替え口。DNS のレコードと証明書はこのモジュールでは作らない（docs/adr/0023-static-site-delivery-with-cloudfront-and-s3.md）。
# 未指定なら CloudFront が払い出すドメインのまま配信する
variable "domain_names" {
  type        = list(string)
  description = "独自ドメイン名（CloudFront の別名）。空なら CloudFront が払い出すドメインのまま配信する。指定するときは acm_certificate_arn も要る。"
  default     = []
}

variable "acm_certificate_arn" {
  type        = string
  description = "独自ドメイン用の ACM 証明書の ARN（us-east-1 で発行したもの）。domain_names を指定するときだけ渡す。"
  default     = null
  # ARN にアカウントIDが入るため
  sensitive = true

  validation {
    # 未指定の null は、ここで先に通す（次の検査で正規表現に渡さない）
    condition     = (length(var.domain_names) == 0) == (var.acm_certificate_arn == null)
    error_message = "domain_names と acm_certificate_arn は、両方指定するか両方未指定にしてください。"
  }

  validation {
    # CloudFront が使える証明書は、us-east-1 のものに限る
    condition     = var.acm_certificate_arn == null || can(regex("^arn:aws:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn は us-east-1 の ACM 証明書（arn:aws:acm:us-east-1:...）にしてください。"
  }
}

# 共有の部品（Cognito など）の切り替え口。3つがそろったときだけ作る（docs/adr/0035-share-by-unguessable-url-with-google-login.md）
variable "google_client_id" {
  type        = string
  description = "Google の OAuth クライアント ID。空なら共有の部品を作らない。設定するときは google_client_secret と cognito_domain_prefix も要る。"
  default     = ""

  validation {
    condition = (
      (var.google_client_id == "") == (var.google_client_secret == "") &&
      (var.google_client_id == "") == (var.cognito_domain_prefix == "")
    )
    error_message = "google_client_id・google_client_secret・cognito_domain_prefix は、すべて設定するか、すべて空にしてください。"
  }
}

variable "google_client_secret" {
  type        = string
  description = "Google の OAuth クライアントシークレット。Cognito の IdP の設定に要るため、状態ファイルに入る（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。"
  default     = ""
  sensitive   = true
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Cognito のホステッド UI のドメインの接頭辞。リージョン内で全アカウント共通なので、重ならない名前にする。アカウントIDは入れない（公開される URL に出る）。"
  default     = ""

  validation {
    # 空は未設定。Cognito の API は先頭・末尾のハイフンを受け付けない
    condition     = var.cognito_domain_prefix == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix は、小文字の英数字とハイフンの1〜63文字（先頭と末尾はハイフン不可）にしてください。"
  }

  validation {
    # Cognito が接頭辞に使えない語
    condition     = !can(regex("cognito|aws|amazon", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix に cognito・aws・amazon を含めないでください（Cognito が禁じています）。"
  }
}

# Lambda に載せるファイル（pnpm --filter api build の成果物）。共有の部品を作るときだけ読む
variable "api_bundle_path" {
  type        = string
  description = "Lambda に載せるビルド済みの 1 ファイル。共有の部品を作る前に pnpm --filter api build で作る。"
  default     = "../../apps/api/dist/index.mjs"
}
