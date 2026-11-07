# 状態ファイル用バケットの構成を確かめる。モックなので AWS の認証情報は要らない。
# アカウントID・リージョンはデータソースで引くため、override_data で架空の値を入れる。`aws_region` は `region` 属性を使う。
# プロバイダ側の設定の検証（`bucket_namespace` と名前の接尾辞の整合など）はモックでは走らず、実際の plan で初めて分かる。

variables {
  github_oidc_sub_prefix = "repo:example-owner@1000/example-repo@2000"
}

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
}

run "bucket_名前_既定値で形式どおりになる" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.bucket == "shirabe-prd-s3-state-123456789012-ap-northeast-1-an"
    error_message = "バケット名が shirabe-prd-s3-state-<アカウントID>-<リージョン>-an になっていない: ${aws_s3_bucket.state.bucket}"
  }

  assert {
    condition     = aws_s3_bucket.state.bucket_namespace == "account-regional"
    error_message = "bucket_namespace が account-regional でない"
  }
}

run "bucket_バージョニングが有効" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "バージョニングが有効になっていない"
  }
}

run "bucket_暗号化がSSE-S3" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "サーバー側暗号化が SSE-S3（AES256）でない"
  }
}

run "bucket_パブリックアクセスを4項目すべてブロック" {
  command = plan

  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls
    error_message = "block_public_acls が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_policy
    error_message = "block_public_policy が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.ignore_public_acls
    error_message = "ignore_public_acls が true でない"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "restrict_public_buckets が true でない"
  }
}

run "bucket_所有者強制" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_ownership_controls.state.rule).object_ownership == "BucketOwnerEnforced"
    error_message = "object_ownership が BucketOwnerEnforced でない"
  }
}

run "bucket_TLS以外を拒否するポリシー" {
  command = plan

  assert {
    condition     = aws_s3_bucket_policy.state.bucket == aws_s3_bucket.state.bucket
    error_message = "ポリシーが状態ファイル用バケットに付いていない"
  }

  assert {
    condition     = length(jsondecode(aws_s3_bucket_policy.state.policy).Statement) == 1
    error_message = "ポリシーの Statement がちょうど1つでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Effect == "Deny"
    error_message = "Effect が Deny でない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Principal == "*"
    error_message = "Principal が * でない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Action == "s3:*"
    error_message = "Action が s3:* でない"
  }

  assert {
    condition = (
      toset(jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Resource)
      == toset([
        "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an",
        "arn:aws:s3:::shirabe-prd-s3-state-123456789012-ap-northeast-1-an/*",
      ])
    )
    error_message = "Resource がバケットとバケット配下の2つでない"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "条件が aws:SecureTransport = false でない"
  }
}

run "bucket_古いバージョンを90日で削除するライフサイクル" {
  command = plan

  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.state.rule).status == "Enabled"
    error_message = "ライフサイクルのルールが有効でない"
  }

  assert {
    condition     = one(one(aws_s3_bucket_lifecycle_configuration.state.rule).noncurrent_version_expiration).noncurrent_days == 90
    error_message = "古い版を消すまでの日数が 90 日でない"
  }

  # 90日更新が無くても現行の状態ファイルが消えないよう、現行版を日数や日付で消す expiration は付けない
  assert {
    condition = alltrue([
      for e in one(aws_s3_bucket_lifecycle_configuration.state.rule).expiration : e.days == null && e.date == null
    ])
    error_message = "現行版を期限で消す expiration（days か date）が付いている"
  }
}

run "bucket_Projectタグがshirabe-chordで付く" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.tags["Project"] == "shirabe-chord"
    error_message = "Project タグが shirabe-chord で付いていない"
  }
}
