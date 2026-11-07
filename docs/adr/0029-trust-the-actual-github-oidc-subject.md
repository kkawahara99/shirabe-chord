# 0029. OIDC の信頼条件は、GitHub が実際に発行する sub の接頭辞を API から取って渡す

- **Status**: Active
- **Date**: 2026-11-07

## Context

デプロイ用と PR 用のロールは、信頼の条件をリポジトリと ref に限っている（[0003](0003-account-agnostic.md)）。当初は条件を `repo:<owner>/<repo>:...` の形で組み立てていた。実環境で初めて流すと、引き受けが拒否された。GitHub がこのリポジトリに発行する sub（OIDC トークンの主体）は、所有者とリポジトリの数値 ID を含む不変の形（`repo:<owner>@<ID>/<repo>@<ID>:...`）だった。形はリポジトリの設定で決まる。テストはモックで動くので、この食い違いを見つけられない。

## Decision

- 変数 `github_oidc_sub_prefix` に、`gh api repos/<owner>/<repo>/actions/oidc/customization/sub` の `sub_claim_prefix` の値をそのまま渡す。変数 `github_repository` はやめる。
- 信頼の条件は `<接頭辞>:ref:refs/heads/main` と `<接頭辞>:pull_request` を `StringEquals` の完全一致にする。
- 変数の検証は、不変の形と従来の形（`repo:<owner>/<repo>`）を通し、片方だけに ID がある値や sub 全体を止める。

## Consequences

- 同じ名前のリポジトリを別の人が作っても ID が違うので、不変の形の条件には一致しない。
- 接頭辞には名前も入っているので、所有者やリポジトリの名前を変えたら、API の値を取り直して、変わっていれば `bootstrap` を適用し直す。適用するまで引き受けは拒否される（安全な側に失敗する）。
- リポジトリの設定（`use_immutable_subject`）で形が変わったときも同じ。変数の検証は形を確かめるだけで、値が今の設定と合っているかは実際に流すまで分からない。
- sub をカスタマイズしたリポジトリ（API の `use_default` が `false`）は対象にしない。後ろの部分（`:ref:refs/heads/main` など）を固定で足しているので、一致しない場合がある。
- 従来の形のリポジトリでも、API の値を写すだけで同じコードを使える（[0003](0003-account-agnostic.md) の、誰でも試せる形を保つ）。従来の形での引き受けは、実地では確かめていない。

## Why not

- **リポジトリの設定を従来の形に戻す**: 同じ名前で作り直されたリポジトリと区別できなくなる。設定の変更も増える。
- **両方の形を信頼の条件に並べる**: 使わない形の入口まで開ける。
- **`StringLike` のワイルドカードで両方に一致させる**: 条件が広がり、意図しないリポジトリや ref に一致する余地ができる。
- **Terraform の GitHub プロバイダで接頭辞を引く**: `bootstrap` に、GitHub の認証とプロバイダが要るようになる。値は初回に写すだけで足りる。
