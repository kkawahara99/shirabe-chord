# サイト用バケットの構成を確かめる。モックなので AWS の認証情報は要らない。
# プロバイダ側の設定の検証（`bucket_namespace` と名前の接尾辞の整合など）はモックでは走らず、実際の plan で初めて分かる。

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
    target          = aws_cloudfront_distribution.site
    override_during = plan
    values = {
      id          = "EDISTEXAMPLE"
      arn         = "arn:aws:cloudfront::123456789012:distribution/EDISTEXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
}

run "bucket_バージョニングが有効" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.site.versioning_configuration[0].status == "Enabled"
    error_message = "バージョニングが有効になっていない"
  }
}

run "bucket_暗号化がSSE-S3" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.site.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "サーバー側暗号化が SSE-S3（AES256）でない"
  }
}

run "bucket_パブリックアクセスを4項目すべてブロック" {
  command = plan

  assert {
    condition     = aws_s3_bucket_public_access_block.site.block_public_acls
    error_message = "block_public_acls が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.site.block_public_policy
    error_message = "block_public_policy が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.site.ignore_public_acls
    error_message = "ignore_public_acls が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.site.restrict_public_buckets
    error_message = "restrict_public_buckets が true でない"
  }
}

run "bucket_所有者強制" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_ownership_controls.site.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "object_ownership が BucketOwnerEnforced でない"
  }
}

run "bucket_古いバージョンを90日で削除するライフサイクル" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.site.rule).status == "Enabled"
    error_message = "ライフサイクルのルールが有効でない"
  }

  assert {
    condition     = one(one(aws_s3_bucket_lifecycle_configuration.site.rule).noncurrent_version_expiration).noncurrent_days == 90
    error_message = "古い版を消すまでの日数が 90 日でない"
  }

  # 現行のサイトのファイルが期限で消えないよう、現行版を日数や日付で消す expiration は付けない
  assert {
    condition = alltrue([
      for e in one(aws_s3_bucket_lifecycle_configuration.site.rule).expiration : e.days == null && e.date == null
    ])
    error_message = "現行版を期限で消す expiration（days か date）が付いている"
  }
}

run "bucket_Projectタグがshirabe-chordで付く" {
  command = plan

  assert {
    condition     = aws_s3_bucket.site.tags["Project"] == "shirabe-chord"
    error_message = "S3 バケットに Project タグが shirabe-chord で付いていない"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.tags["Project"] == "shirabe-chord"
    error_message = "CloudFront ディストリビューションに Project タグが shirabe-chord で付いていない"
  }
}
