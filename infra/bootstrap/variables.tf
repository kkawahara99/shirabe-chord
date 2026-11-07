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

variable "github_oidc_sub_prefix" {
  type        = string
  description = "GitHub Actions に AWS への入口を許すリポジトリの、OIDC トークンの sub の接頭辞。形はリポジトリの設定で変わるので、gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix の出力をそのまま渡す（docs/adr/0029-trust-the-actual-github-oidc-subject.md）。"

  validation {
    # 不変の形（repo:owner@ID/repo@ID）か、従来の形（repo:owner/repo）。片方だけに ID がある値は、書き写しの誤りとして止める
    condition     = can(regex("^repo:(?:[A-Za-z0-9-]+@[0-9]+/[A-Za-z0-9._-]+@[0-9]+|[A-Za-z0-9-]+/[A-Za-z0-9._-]+)$", var.github_oidc_sub_prefix))
    error_message = "github_oidc_sub_prefix は repo:owner@ID/repo@ID か repo:owner/repo の形にしてください（gh api repos/<owner>/<repo>/actions/oidc/customization/sub の sub_claim_prefix の値）。"
  }
}

variable "create_github_oidc_provider" {
  type        = bool
  description = "GitHub の OIDC プロバイダを新しく作るか。1 アカウントに同じ URL で 1 つしか作れないので、既にあるアカウント（ランディングゾーンが作った場合など）では false にして既存のものを使う（docs/adr/0003-account-agnostic.md）。"
  default     = true
}
