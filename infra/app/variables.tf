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
