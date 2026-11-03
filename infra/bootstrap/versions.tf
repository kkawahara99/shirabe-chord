terraform {
  # S3 の backend の use_lockfile（1.11.0 で一般提供）と、テストの override_during（1.11.0 で追加）を使うため
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # bucket_namespace（aws_s3_bucket）は 6.37.0 で追加された
      version = ">= 6.37.0, < 7.0"
    }
  }
}
