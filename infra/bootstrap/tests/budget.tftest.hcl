# 費用のアラート（AWS Budgets）の中身を確かめる（docs/adr/0030-budget-alert-in-bootstrap.md）。
# 通知は宛先が sensitive なので丸ごと sensitive になる。中身を比べるところだけ nonsensitive で外す。

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

run "budget_種類と単位と通貨" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly.budget_type == "COST"
    error_message = "予算の種類が COST でない"
  }

  assert {
    condition     = aws_budgets_budget.monthly.time_unit == "MONTHLY"
    error_message = "予算の単位が MONTHLY でない"
  }

  assert {
    condition     = aws_budgets_budget.monthly.limit_unit == "USD"
    error_message = "予算の通貨が USD でない"
  }
}

# terraform test は terraform.tfvars を読むので、額を書き換えた手元（main 側）ではこのテストだけ落ちる
run "budget_額は既定で2USD" {
  command = plan

  assert {
    condition     = tonumber(aws_budgets_budget.monthly.limit_amount) == 2
    error_message = "既定の額が 2 でない: ${aws_budgets_budget.monthly.limit_amount}"
  }
}

run "budget_額は変数に追従する" {
  command = plan

  variables {
    monthly_budget_usd = 5
  }

  assert {
    condition     = tonumber(aws_budgets_budget.monthly.limit_amount) == 5
    error_message = "額が monthly_budget_usd に追従していない: ${aws_budgets_budget.monthly.limit_amount}"
  }
}

run "budget_名前は既定値で形式どおり" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly.name == "shirabe-prd-budgets-monthly"
    error_message = "予算の名前が shirabe-prd-budgets-monthly でない: ${aws_budgets_budget.monthly.name}"
  }
}

run "budget_環境がdevだと名前もdevになる" {
  command = plan

  variables {
    environment = "dev"
  }

  assert {
    condition     = aws_budgets_budget.monthly.name == "shirabe-dev-budgets-monthly"
    error_message = "dev の予算の名前が形式どおりでない: ${aws_budgets_budget.monthly.name}"
  }
}

run "budget_Projectタグ" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly.tags["Project"] == "shirabe-chord"
    error_message = "予算に Project タグが shirabe-chord で付いていない"
  }
}

run "budget_費用の絞り込みが無い" {
  command = plan

  assert {
    condition     = length(aws_budgets_budget.monthly.cost_filter) == 0
    error_message = "費用の絞り込み（cost_filter）が付いている（アカウント全体を見るはず）"
  }

  assert {
    condition     = length(aws_budgets_budget.monthly.filter_expression) == 0
    error_message = "費用の絞り込み（filter_expression）が付いている（アカウント全体を見るはず）"
  }
}

run "budget_費用の種類を上書きしていない" {
  command = plan

  assert {
    condition     = length(aws_budgets_budget.monthly.cost_types) == 0
    error_message = "cost_types を書いている（AWS の既定のまま使うはず）"
  }
}

run "budget_通知はACTUALの80と100の2つだけ" {
  command = plan

  assert {
    condition = nonsensitive(toset([
      for n in aws_budgets_budget.monthly.notification : {
        comparison_operator = n.comparison_operator
        threshold           = n.threshold
        threshold_type      = n.threshold_type
        notification_type   = n.notification_type
      }
      ])) == toset([
      {
        comparison_operator = "GREATER_THAN"
        threshold           = 80
        threshold_type      = "PERCENTAGE"
        notification_type   = "ACTUAL"
      },
      {
        comparison_operator = "GREATER_THAN"
        threshold           = 100
        threshold_type      = "PERCENTAGE"
        notification_type   = "ACTUAL"
      },
    ])
    error_message = "通知が、ACTUAL が 80% と 100% を超えたときの 2 つだけでない"
  }
}

run "budget_各通知の購読者はメール1件だけ" {
  command = plan

  assert {
    condition = nonsensitive(alltrue([
      for n in aws_budgets_budget.monthly.notification :
      toset(n.subscriber_email_addresses) == toset(["alerts@example.com"])
      && try(length(n.subscriber_sns_topic_arns), 0) == 0
    ]))
    error_message = "各通知の購読者が budget_alert_email の 1 件だけでない（SNS の購読者も無いはず）"
  }
}

run "budget_宛先は変数に追従する" {
  command = plan

  variables {
    budget_alert_email = "other@example.com"
  }

  assert {
    condition = nonsensitive(alltrue([
      for n in aws_budgets_budget.monthly.notification :
      toset(n.subscriber_email_addresses) == toset(["other@example.com"])
    ]))
    error_message = "どちらかの通知の宛先が budget_alert_email に追従していない"
  }
}

run "budget_宛先はsensitive" {
  command = plan

  assert {
    condition     = issensitive(var.budget_alert_email)
    error_message = "budget_alert_email が sensitive でない"
  }

  assert {
    condition     = issensitive(aws_budgets_budget.monthly.notification)
    error_message = "予算の通知が sensitive でなく、plan の出力に宛先が出る"
  }
}
