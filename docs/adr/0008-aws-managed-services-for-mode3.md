# 0008. モード 3 の部品は、AWS のマネージドサービスで揃える

- **Status**: Active
- **Date**: 2026-11-03

## Context

[0006](0006-product-scope-and-stages.md) は、モード 3（掲載とコメント）の部品を「認証・API・データ・上限」としか決めていない。データ層には、AWS の DynamoDB のほかに、Cloudflare の D1（SQL が使え、無料枠が大きい）という候補があった。D1 を選ぶと、API は Workers、配信は Pages と、Cloudflare に寄る。

## Decision

- モード 3 の部品は、AWS のマネージドサービスで揃える。
  - データ層は DynamoDB（掲載は投稿 ID、コメントは投稿 ID で引ける。結合や集計は要らない）。
  - ログインは Cognito。
  - 回数の上限は API Gateway のスロットリング。
  - 投稿された押さえ方の構成音の検証と、Turnstile のトークンの検証は Lambda（[0007](0007-typescript-shared-core.md)）。

## Consequences

- AWS だけで、IaC（Terraform）、デプロイ、権限の管理が一貫する（[0002](0002-iac-tool-terraform.md)・[0003](0003-account-agnostic.md)）。
- DynamoDB は、検索の切り口を後から増やすと、テーブルの設計をやり直しやすい。一覧の絞り込みや全文検索は、0006 の範囲に入れていない。
- 各サービスの使い方は、実装の Issue で確かめる。合わなければ、新しい ADR で置き換える。

## Why not

- **Cloudflare D1（と Workers・Pages）**: SQL と無料枠は魅力だが、このデータに結合は要らない。AWS と混ぜると認証と DB の間が別のクラウドになり、IaC・権限・デプロイが二重になる。全面的に Cloudflare に寄せるのは、0002・0003 の前提を変える大きな方針転換になる。
- **ログインを自前で作る**: パスワードの保管や再設定を自分で守ることになり、荒らし対策より重い。
- **上限を WAF で行う**: 費用が増える。このサイトの規模では、API Gateway のスロットリングと Turnstile で足りる。
