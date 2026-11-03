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

`terraform test`（`tests/*.tftest.hcl`）を `mock_provider "aws"` で動かす（認証情報は要らない）。モックの癖は、該当テストのコメントに書く。

- plan では ARN や ID などの計算値が不明なので、それに頼る `assert` は `override_resource`／`override_data`（`override_during = plan`）か `command = apply` にする。
- `aws_iam_policy_document` はモックで中身が空になる。ポリシーは `jsonencode` で書く。
- プロバイダ側の設定の検証（`bucket_namespace` と名前の接尾辞の整合など）はモックでは走らない。実際の plan で確かめる。
- リソース同士の参照は `.id` ではなく、plan で分かる `.bucket` のような属性にする。
- タグは `default_tags` を使わず、リソースごとに `Project` タグの `assert` を書く。
- アカウントIDの実値は、コミット・Issue・PR に貼らない。バケット名、`terraform output`・`plan` の出力、`backend.app.hcl` の中身にも入っているので、これらも貼らない。架空の値は `123456789012`。

検査コマンドは [CLAUDE.md](../CLAUDE.md) のテストコマンドを参照。
