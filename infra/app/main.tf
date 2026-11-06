provider "aws" {
  region = var.region
}

# アカウントIDとリージョンは、渡さずにデプロイ先から引く（docs/adr/0005-resource-naming.md）
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  # default_tags はモックの下で tags_all に現れずテストで確かめられないため、リソースの tags に直接付ける（infra/README.md）
  tags = {
    Project = "shirabe-chord"
  }

  # <プロジェクト名>-<環境名>-s3-site-<アカウントID>-<リージョン>-an
  site_bucket_name = "${var.project_name}-${var.environment}-s3-site-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}-an"
  # OAC とレスポンスヘッダポリシーの名前（<プロジェクト名>-<環境名>-cloudfront-site）
  cloudfront_site_name = "${var.project_name}-${var.environment}-cloudfront-site"

  # AWS 管理のキャッシュポリシー CachingOptimized の固定 ID。data で引くと、デプロイ用ロールにキャッシュポリシーの読み取りが要るため直書きする
  caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

  use_custom_domain = length(var.domain_names) > 0
}

# --- サイト用バケット（非公開。CloudFront の OAC 経由でだけ読める） ---

resource "aws_s3_bucket" "site" {
  bucket           = local.site_bucket_name
  bucket_namespace = "account-regional"
  tags             = local.tags
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.bucket

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.bucket

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.bucket

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# デプロイのたびにハッシュ付きのファイルが入れ替わり、古い版が溜まるので、古い版だけを消す。現行のファイルは消えない
resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.bucket

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  # バージョニングを先に有効にする（AWS の要件）
  depends_on = [aws_s3_bucket_versioning.site]
}

# ポリシーは jsonencode で書き、ARN は名前から組み立てる（aws_iam_policy_document はモックされて json が空になるため。infra/README.md）
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.bucket

  # ARN のパーティションは aws に固定する（中国・GovCloud のリージョンは対象外）
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          "arn:aws:s3:::${local.site_bucket_name}",
          "arn:aws:s3:::${local.site_bucket_name}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        # この CloudFront のディストリビューションからだけ読める（OAC）
        Sid       = "AllowCloudFrontServicePrincipalReadOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "arn:aws:s3:::${local.site_bucket_name}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.site.arn
          }
        }
      },
    ]
  })

  # パブリックアクセスのブロックと同時に変更すると競合しうるため、順番を固定する
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# --- CloudFront ---

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.cloudfront_site_name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS 管理の SecurityHeadersPolicy は CSP が無く X-Frame-Options が SAMEORIGIN なので使わない（docs/adr/0023-static-site-delivery-with-cloudfront-and-s3.md）
resource "aws_cloudfront_response_headers_policy" "site" {
  name = local.cloudfront_site_name

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      # preload はサブドメインを含めた恒久的な登録になり戻しにくいので付けない
      preload  = false
      override = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    content_security_policy {
      # ビルド成果物は同じオリジンの /assets/*.js・/assets/*.css・/favicon.svg だけを読み込む（確かめた内容は tests/headers.tftest.hcl）
      content_security_policy = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
      override                = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  aliases             = var.domain_names
  tags                = local.tags

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_optimized_policy_id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # 独自ドメインを指定したときだけ ACM 証明書を使う。指定しないときは CloudFront 既定の証明書（最小 TLS は CloudFront 側で決まる）
  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_domain ? null : true
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : null
  }
}
