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
