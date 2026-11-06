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

variable "github_repository" {
  type        = string
  description = "GitHub Actions に AWS への入口を許すリポジトリ（owner/repo の形）。信頼ポリシーの StringEquals は大文字小文字を区別するので、GitHub 上の実際の表記に合わせる。"

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository は owner/repo の形にしてください（owner は英数字とハイフン、repo は英数字と . _ -）。"
  }
}

variable "create_github_oidc_provider" {
  type        = bool
  description = "GitHub の OIDC プロバイダを新しく作るか。1 アカウントに同じ URL で 1 つしか作れないので、既にあるアカウント（ランディングゾーンが作った場合など）では false にして既存のものを使う（docs/adr/0003-account-agnostic.md）。"
  default     = true
}
