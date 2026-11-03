# infra

Terraform のコード。IaC に Terraform を選んだ理由は [ADR 0002](../docs/adr/0002-iac-tool-terraform.md)、名前の付け方は [ADR 0005](../docs/adr/0005-resource-naming.md)。

- `bootstrap/` … 初回だけ手で適用する準備用のルートモジュール。状態ファイル用の S3 バケットを作る。[手順](bootstrap/README.md)
- 本体のルートモジュールは `app/` に置く（後続の Issue で作る）。

## 後続のコードが従う置き方

- **版の固定**: `versions.tf` に `required_version` と、プロバイダの `version`（下限と `< 7.0` の上限）を書く。`.terraform.lock.hcl` はコミットし、`terraform providers lock -platform=windows_amd64 -platform=linux_amd64 -platform=darwin_arm64` で3環境の分を入れる（CI の Linux でも同じロックファイルを使うため）。
- **backend の渡し方**: 接続先（バケット名）はアカウント固有の情報なので、コードに書かず、`backend.<ルートモジュール名>.hcl`（gitignore 対象）に分けて `terraform init -backend-config=...` で渡す。`bootstrap/` 自身の状態だけは手元のローカルに置く。
- **名前**: 1つのルートモジュールにつき `locals` の1か所で組み立てる。アカウントIDは `data "aws_caller_identity"`、リージョンは `data "aws_region"`（属性は `region`。`name` は非推奨）で、プロバイダの値を引く。アカウントIDは変数やコードで渡さない。
- **タグ**: `Project = "shirabe-chord"` を `local.tags` にまとめ、タグを付けられるリソースの `tags` に直接付ける。`default_tags` はモックの下で `tags_all` に現れず、テストで確かめられないため使わない。

## テストの書き方

`terraform test`（`tests/*.tftest.hcl`）を使い、`mock_provider "aws"` で AWS の認証情報なしに動かす。モックには次の癖がある。

- plan の時点では、ARN や ID などの計算される値が不明のまま。それに頼る `assert` は評価できない（`Unknown condition value`）。リソース同士の参照は `.id` ではなく、設定した値の `.bucket` のように plan で分かる属性にする。
- `aws_iam_policy_document` もプロバイダのデータソースなのでモックされ、`json` が意味のない値になる。IAM やバケットのポリシーは `jsonencode` で書き、ARN は名前などの入力から組み立てる。
- 計算される値に頼る `assert` は、`mock_provider` の `override_resource`／`override_data` に `override_during = plan` を付けるか、`run` を `command = apply` にして書く（モックなので apply でも AWS には触れない）。
- `data "aws_caller_identity"` と `data "aws_region"` もモックされるので、`override_data` で架空の値を入れる（`aws_region` は `region`）。架空のアカウントIDは `123456789012`。`run` の中の `override_data` で、そのテストだけ値を差し替えられる。
- プロバイダ側の設定の検証はモックでは走らない（例: `bucket_namespace` と名前の接尾辞の整合）。実際の plan で初めて分かることがある。
- タグは `default_tags` で足されないので、タグを付けられるリソースごとに `Project` タグの `assert` を書く（付け忘れに気づけるように）。
- 入力変数の `validation` は `command = plan` と `expect_failures = [var.<名前>]` で確かめる。`terraform test` に性質テストの仕組みは無いので、境界値の点で書く。

本物のアカウントIDは、コミット・コミットメッセージ・Issue・PR・README の例に書かない。バケット名（アカウントIDが入る）、`terraform output` と `plan` の出力、`backend.app.hcl` の中身も貼らない。

## 検査

リポジトリ直下から次を実行する。AWS の認証情報は要らない。

```sh
terraform -chdir=infra/bootstrap fmt -check -recursive
terraform -chdir=infra/bootstrap init -backend=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test
```
