# 入力変数の validation を確かめる。terraform test には性質テストの仕組みが無いため、境界値の点で確かめる。

variables {
  github_repository = "example-owner/example-repo"
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

# --- project_name ---

run "project_name_正常_2文字は通る" {
  command = plan
  variables {
    project_name = "im"
  }
  assert {
    condition     = var.project_name == "im"
    error_message = "2文字の project_name が通らない"
  }
}

run "project_name_正常_10文字は通る" {
  command = plan
  variables {
    project_name = "abcdefghij"
  }
  assert {
    condition     = var.project_name == "abcdefghij"
    error_message = "10文字の project_name が通らない"
  }
}

run "project_name_正常_数字を含んでも通る" {
  command = plan
  variables {
    project_name = "im2"
  }
  assert {
    condition     = var.project_name == "im2"
    error_message = "数字を含む project_name が通らない"
  }
}

run "project_name_異常_大文字は失敗" {
  command = plan
  variables {
    project_name = "Im"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_1文字は失敗" {
  command = plan
  variables {
    project_name = "i"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_11文字は失敗" {
  command = plan
  variables {
    project_name = "abcdefghijk"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_ハイフンは失敗" {
  command = plan
  variables {
    project_name = "im-x"
  }
  expect_failures = [var.project_name]
}

run "project_name_異常_空は失敗" {
  command = plan
  variables {
    project_name = ""
  }
  expect_failures = [var.project_name]
}

# --- environment ---

run "environment_正常_dev" {
  command = plan
  variables {
    environment = "dev"
  }
  assert {
    condition     = var.environment == "dev"
    error_message = "dev が通らない"
  }
}

run "environment_正常_stg" {
  command = plan
  variables {
    environment = "stg"
  }
  assert {
    condition     = var.environment == "stg"
    error_message = "stg が通らない"
  }
}

run "environment_正常_prd" {
  command = plan
  variables {
    environment = "prd"
  }
  assert {
    condition     = var.environment == "prd"
    error_message = "prd が通らない"
  }
}

run "environment_異常_prodは失敗" {
  command = plan
  variables {
    environment = "prod"
  }
  expect_failures = [var.environment]
}

run "environment_異常_空は失敗" {
  command = plan
  variables {
    environment = ""
  }
  expect_failures = [var.environment]
}

run "environment_異常_大文字は失敗" {
  command = plan
  variables {
    environment = "PRD"
  }
  expect_failures = [var.environment]
}

# --- region ---

run "region_正常_通常のリージョンは通る" {
  command = plan
  variables {
    region = "us-east-1"
  }
  assert {
    condition     = var.region == "us-east-1"
    error_message = "通常のリージョンが通らない"
  }
}

run "region_異常_me-south-1は失敗" {
  command = plan
  variables {
    region = "me-south-1"
  }
  expect_failures = [var.region]
}

run "region_異常_me-central-1は失敗" {
  command = plan
  variables {
    region = "me-central-1"
  }
  expect_failures = [var.region]
}

# --- github_repository ---

run "github_repository_正常_owner_repoの形は通る" {
  command = plan
  variables {
    github_repository = "example-owner/example-repo"
  }
  assert {
    condition     = var.github_repository == "example-owner/example-repo"
    error_message = "example-owner/example-repo の github_repository が通らない"
  }
}

run "github_repository_正常_repo名に点_アンダースコア_ハイフンを含んでも通る" {
  command = plan
  variables {
    github_repository = "o-1/my.repo_x-y"
  }
  assert {
    condition     = var.github_repository == "o-1/my.repo_x-y"
    error_message = "o-1/my.repo_x-y の github_repository が通らない"
  }
}

run "github_repository_異常_スラッシュなしは失敗" {
  command = plan
  variables {
    github_repository = "example-repo"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_空は失敗" {
  command = plan
  variables {
    github_repository = ""
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_ownerが空は失敗" {
  command = plan
  variables {
    github_repository = "/repo"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_repoが空は失敗" {
  command = plan
  variables {
    github_repository = "owner/"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_スラッシュが2つは失敗" {
  command = plan
  variables {
    github_repository = "a/b/c"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_ownerにアンダースコアを含むと失敗" {
  command = plan
  variables {
    github_repository = "a_b/c"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_ownerに点を含むと失敗" {
  command = plan
  variables {
    github_repository = "a.b/c"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_アスタリスクを含むと失敗" {
  command = plan
  variables {
    github_repository = "owner/re*po"
  }
  expect_failures = [var.github_repository]
}

run "github_repository_異常_空白を含むと失敗" {
  command = plan
  variables {
    github_repository = "owner/re po"
  }
  expect_failures = [var.github_repository]
}
