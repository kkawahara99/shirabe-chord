# GitHub Actions 用の OIDC プロバイダの「作る／既存を使う」の切り替えを確かめる（docs/adr/0003-account-agnostic.md）。
# ロールがプロバイダより後に作られる順（depends_on）は、plan からは見えないのでテストしない。
# 信頼ポリシーの Federated は、プロバイダの ARN を参照せず、アカウントIDから組み立てる。

variables {
  github_oidc_sub_prefix = "repo:example-owner@1000/example-repo@2000"
  budget_alert_email     = "alerts@example.com"
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

run "oidc_既定ではプロバイダを作る" {
  command = plan

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 1
    error_message = "既定で OIDC プロバイダが作られない"
  }

  assert {
    condition     = length(data.aws_iam_openid_connect_provider.github) == 0
    error_message = "作る場合に既存のプロバイダを引いている"
  }

  assert {
    condition     = aws_iam_openid_connect_provider.github[0].url == "https://token.actions.githubusercontent.com"
    error_message = "プロバイダの URL が GitHub のものでない"
  }

  assert {
    condition     = aws_iam_openid_connect_provider.github[0].client_id_list == toset(["sts.amazonaws.com"])
    error_message = "client_id_list が sts.amazonaws.com だけでない"
  }

  assert {
    condition     = aws_iam_openid_connect_provider.github[0].tags["Project"] == "shirabe-chord"
    error_message = "プロバイダに Project タグが shirabe-chord で付いていない"
  }
}

run "oidc_falseなら作らず既存を引く" {
  command = plan

  variables {
    create_github_oidc_provider = false
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "false なのに OIDC プロバイダを作ろうとしている"
  }

  assert {
    condition     = length(data.aws_iam_openid_connect_provider.github) == 1
    error_message = "false のとき既存のプロバイダを引いていない"
  }

  assert {
    condition     = data.aws_iam_openid_connect_provider.github[0].url == "https://token.actions.githubusercontent.com"
    error_message = "既存のプロバイダを GitHub の URL で引いていない"
  }
}

run "oidc_作る場合の信頼ポリシーのFederatedはアカウントIDから組み立てる" {
  command = plan

  assert {
    condition = alltrue([
      for role_policy in [aws_iam_role.deploy.assume_role_policy, aws_iam_role.plan.assume_role_policy] :
      jsondecode(role_policy).Statement[0].Principal == { Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
    ])
    error_message = "Federated が arn:aws:iam::<アカウントID>:oidc-provider/token.actions.githubusercontent.com でない"
  }
}

run "oidc_既存を使う場合も信頼ポリシーのFederatedは同じ" {
  command = plan

  variables {
    create_github_oidc_provider = false
  }

  assert {
    condition = alltrue([
      for role_policy in [aws_iam_role.deploy.assume_role_policy, aws_iam_role.plan.assume_role_policy] :
      jsondecode(role_policy).Statement[0].Principal == { Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
    ])
    error_message = "既存を使う場合の Federated が、作る場合と同じ ARN でない"
  }
}
