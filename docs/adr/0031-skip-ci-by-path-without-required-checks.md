# 0031. PR の test と plan は変更されたパスで飛ばし、plan は取り消さない

- **Status**: Active
- **Date**: 2026-11-07

## Context

[0027](0027-ci-cd-with-three-workflows.md) の test と plan は、PR のたびに毎回すべて流れていた。リポジトリは公開で標準ランナーは無料なので、減らす狙いは課金ではなく待ち時間と、plan が状態ファイルのロックを取り合う回数である。`main` にはブランチ保護もルールセットも無く、必須のチェックも無い。そのため、チェックが報告されなくてもマージは止まらない。

## Decision

- plan（`plan.yml`）は `pull_request` に `paths: [infra/app/**, .github/workflows/plan.yml]` を付ける。plan は `infra/app` しか見ない。
- test（`test.yml`）は `pull_request` に `paths-ignore: [docs/**, "**/*.md"]` を付ける。
- test の Terraform の手順は別ジョブ `terraform` に分ける。ジョブの中の判定のステップが、PR のときだけ `infra/**` と `test.yml` の変更を `git diff --name-only HEAD^1 HEAD` で見て、無ければ後ろの手順を `if` で飛ばす（ジョブ自体は成功で終わる）。PR 以外（`deploy.yml` 経由の push）では判定のステップが必ず `true` を出して常に流す。判定のステップには `if` を付けない。
- test は `concurrency` で、PR では新しい push が古い実行を取り消す。group は PR 番号、PR 以外は `run_id` にして、`deploy.yml` から呼ばれたとき `deploy` の group と衝突しないようにする。
- plan は `concurrency` で待ちを PR ごとに 1 つにまとめるが、取り消さない（`cancel-in-progress: false`）。
- `deploy.yml` は変えない。
- 守る条件は `.github/tests/test_workflows.py` に足す。

## Consequences

- docs だけの PR では test が走らず、apps だけの PR では plan が走らず Terraform の手順が飛ぶ。
- 将来ブランチ保護で test や plan を必須にするときは注意が要る。ワークフロー単位の `paths`・`paths-ignore` で飛ばすとチェックが報告されず、必須にすると待ち続ける。ジョブの `if` や手順の `if` で飛ばせば報告される。必須にする前に、test と plan の飛ばし方をジョブか手順の `if` へ移す。Terraform の検査のジョブ（`terraform`）はすでにこの形にしてある。
- 判定のステップに `if` を付けると、main で Terraform の検査が黙って抜ける。テストで止める。
- ジョブを分けるぶんランナーの合計時間は増えうるが、公開リポジトリでは課金されない。

## Why not

- **plan を取り消す**: 実行中の plan は状態ファイルのロックを持つ。途中で止めるとロックが残り、次の plan が待たされる。`deploy.yml` が apply を止めないのと同じ理由。
- **サードパーティの paths フィルタ用アクションを使う**: 依存が増え、固定と版の更新の手間が増える。標準の `git diff` で足りる。
- **test 全体を `paths` で絞る**: TypeScript や Python の変更を取りこぼしやすい。飛ばすのは docs だけにとどめ、Terraform だけを変更の有無で分ける。
- **`terraform` ジョブ自体に `if` を付けて飛ばす**: 画面にジョブが skipped と出て、「検査して問題なし」と「飛ばした」が区別できなくなる。手順の `if` なら、ジョブは成功で終わり、飛ばした手順だけが skipped と出る。
