# shirabe-chord

コード進行を入れると、ギターの押さえ方の並び（手の移動が少なく弾きやすいもの）を出すサイト。ギターを弾かない作曲者が、ギター担当に渡す譜面を作る助けにする。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture-dark.png">
  <img src="docs/images/architecture-light.png" alt="構成図。利用者のブラウザは CloudFront から S3 の静的ファイルを取得する（モード 1・2）。GitHub Actions は OIDC で IAM ロールを引き受ける。デプロイ用のロールが CloudFront とサイト用の S3 を更新し、状態ファイルを読み書きする。モード 3 では、Cognito でログインし、API Gateway と Lambda を通して DynamoDB に掲載とコメントを保存する（予定）。人間かどうかの確認は Turnstile に任せる（予定）。">
</picture>

2026-11-07 時点の構成図で、モード 3 の部品は予定（アイコンは [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)）。`bootstrap`・`app` のバッジは作成済みのもので、実装が進むと食い違う。矢印の更新を行うのはデプロイ用のロールで、PR 用のロールは読み取りとロックだけ。

次の 3 つのモードを、番号順に作る（[docs/adr/0006](docs/adr/0006-product-scope-and-stages.md)）。

1. 自由にコード進行を入れて、出力を得る（ログイン不要）。
2. 出力を、各コードの押さえ方の候補から選び直して微調整する。
3. 出力を恒久的に掲載し、コメントを残せる（書き込みはログイン必須）。

状態: モード 1 を AWS で配信している。main へのマージで自動的にデプロイされる。

手元で動かす（Node.js 24 系と pnpm が要る。版は `package.json` の `packageManager`）:

```
pnpm install
pnpm --filter web dev
```

表示された URL（通常は http://localhost:5173/ ）をブラウザで開く。静的ファイルにするには `pnpm --filter web build`（`apps/web/dist` にできる）。画面は [docs/adr/0019](docs/adr/0019-web-screen-with-vite-and-react.md)。

## 構成

モード 1・2 は静的サイトで、コード理論と最適化はブラウザの中で動かす。上の図の理由は [docs/adr/](docs/adr/)（実装は TypeScript で [ADR 0007](docs/adr/0007-typescript-shared-core.md)、IaC は Terraform で [infra/](infra/README.md)、Organizations に依存しない [ADR 0003](docs/adr/0003-account-agnostic.md)、配信は [ADR 0023](docs/adr/0023-static-site-delivery-with-cloudfront-and-s3.md)、CI/CD は [ADR 0027](docs/adr/0027-ci-cd-with-three-workflows.md)）。

## 自分の AWS アカウントに置く

前提条件:

- Terraform と GitHub CLI（`gh`）が要る。自分のリポジトリ（fork）で行い、fork では Actions を有効にする。
- リージョンを制限する SCP（組織で一律にかけるアクセス制限）があると、`us-east-1` が拒否されることがある。独自ドメインの証明書を置く場所で、SCP の作り方によっては CloudFront や IAM の操作も止まる。
- 新しいアカウントでは、利用枠（クォータ）が低いことや、一部のサービスが使えないことがある。

適用の順序:

1. `infra/bootstrap` を手で適用し、GitHub Secrets を 4 つ入れる（[手順](infra/bootstrap/README.md)）。状態ファイル用のバケット、GitHub の OIDC プロバイダ、ロール 2 つ、費用のアラートの予算ができる。これ以降、main への push はデプロイになる。
2. main に push する（押すコミットが無ければ空のコミットでよい）。`deploy.yml` が `infra/app` を適用し、サイトを置く。
3. 公開 URL は `infra/app` の出力 `distribution_domain_name`。手元で読むには、`backend.app.hcl` を作って（[手順](infra/bootstrap/README.md)の 5）`terraform init -backend-config=backend.app.hcl` を流す。

失敗した実行をやり直すときは、main の最新のコミットの実行を選ぶ。古いコミットの実行をやり直すと、サイトとインフラがその版に戻る。

独自ドメインに切り替える: 手元の `infra/app/terraform.tfvars` に `domain_names` と `acm_certificate_arn`（`us-east-1` の証明書）を書いて適用し、DNS を `distribution_domain_name` へ向ける。CI への渡し方は未定で、手元で切り替えても次の自動デプロイで元に戻る。証明書と DNS は自分の環境で用意する（[ADR 0023](docs/adr/0023-static-site-delivery-with-cloudfront-and-s3.md)）。

## 開発フロー

- 作業ガイドは [CLAUDE.md](CLAUDE.md) を参照。
- 設計判断（Why / Why not）は [docs/adr/](docs/adr/) に記録する。
- タスクは GitHub Issue で管理する（`.claude/skills/create-issue` → `.claude/skills/work-issue`）。

## コミット前の検査

このリポジトリは公開する前提で扱う（[docs/adr/0004](docs/adr/0004-treat-as-public-from-day-one.md)）。コミットのたびに、`private/` のファイルがステージされていないか、禁止語や秘密情報・個人情報の形が含まれていないかを検査する（[.githooks/](.githooks/)）。push の前には、送るコミットすべて（メッセージ・作者とコミッター・パス名と中身・ブランチ名とタグ名）を検査する（[docs/adr/0011](docs/adr/0011-scan-before-push-and-whole-history.md)）。作者とコミッターは、メールが `<ユーザー名>@users.noreply.github.com` で、名前がそのユーザー名であること。clone したら最初に入れる。

1. git 2.31 以上、Python 3.9 以上（検査フックの前提）、[gitleaks](https://github.com/gitleaks/gitleaks) を入れる（Windows なら `winget install Gitleaks.Gitleaks`、macOS なら `brew install gitleaks`、Linux なら [リリース](https://github.com/gitleaks/gitleaks/releases)のバイナリを PATH に置く）。PATH に置けないときは、環境変数 `GITLEAKS` に実行ファイルを指定する。
2. `git config core.hooksPath .githooks` を実行する。
3. `private/denylist.txt` に禁止語を1行1語で書く（UTF-8。空行と `#` で始まる行は無視される。全角・半角と大文字・小文字の違いは吸収する）。このファイルが無いか空のときは、検査できないのでコミットを止める。worktree からコミットしても、メインの作業ツリーの `private/denylist.txt` を使う。別の場所に置くなら、環境変数 `SHIRABE_CHORD_DENYLIST` に指定する。

検査に引っかかったときは、ファイル名・行番号・ルール番号（禁止語リストの行番号か gitleaks のルールID）だけが出る。一致した語や、禁止語を含むファイル名は出さない（何番目のファイルかだけを出す）。伏せたファイルは本人が確かめる。

履歴全体を同じ基準で再照合するには `sh .githooks/scan-history` を流す（禁止語を足した後や、公開する前に。違反が無ければ終了コード 0）。

防げないもの（フックを入れていないクローン、GitHub の Web 画面での編集、1行ごとの部分一致では拾えない書き方、`core.hooksPath` が効かないブランチなど）は [.githooks/README.md](.githooks/README.md) と [ADR 0004](docs/adr/0004-treat-as-public-from-day-one.md) を参照。

検査そのもののテストは `python -m unittest discover -s .githooks` で流す。
