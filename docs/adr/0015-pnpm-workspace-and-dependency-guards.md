# 0015. パッケージ管理に pnpm を使い、依存を守る設定を入れる。コアと画面とサーバーは別パッケージにする

- **Status**: Active
- **Date**: 2026-11-03

## Context

[0007](0007-typescript-shared-core.md) で、コアを DOM や AWS に触れない純粋な関数にし、供給網攻撃への備えを実装の Issue で決めるとした。npm の依存には、乗っ取られたアカウントから公開された悪意ある新しい版や、インストール時に走るスクリプトからの攻撃が入りうる。また、コアが DOM や Node.js の API に触れていないことを、人の注意ではなく型検査で保ちたい。

## Decision

- パッケージ管理は pnpm。版は `package.json` の `packageManager` で固定し、手元の版が違うときは作業を止める。
- 依存の守りは `pnpm-workspace.yaml` に置く。公開から 7 日経っていない版を入れない（`minimumReleaseAge: 10080`）。インストール時のスクリプトは `allowBuilds` に `true` で書いたものだけ走らせる（空で始める）。版は `^`・`~` なしで固定し（`saveExact: true`）、`pnpm-lock.yaml` をコミットする。CI では `pnpm install --frozen-lockfile` を使う。
- ワークスペースは `packages/*` と `apps/*`。コア（`packages/core`）は画面・サーバーと別パッケージにする。コアの `tsconfig.json` は `lib` に `DOM` を入れず `types` を空にし、`document` や `process` の参照を型検査で落とす。テストは、vitest の型が Node の型を引き込みうるため、別の `tsconfig.test.json` で型検査する（コアの検査に混ぜない）。
- コアはビルドしない。`exports` は `src/index.ts` を指し、画面とサーバーのビルドが取り込む。
- Node.js は 24 系（AWS Lambda のランタイムにある LTS）。

## Consequences

- 以降のアプリの Issue は、この構成と依存の決まりに従う。依存を足すときは、公開から 7 日待つ。緊急の修正は、除外の設定（`minimumReleaseAgeExclude`）で名前と版を指定して通せる。
- インストール時スクリプトが要る依存は、`allowBuilds` に足す判断が毎回要る。足さないとインストールが止まる。
- 設定の名前や置き場所は pnpm の版で変わった（`onlyBuiltDependencies` は 11 で `allowBuilds` に置き換わった）。pnpm の版を上げるときは公式ドキュメントで確かめ直す。

## Why not

- **npm**: 公式ドキュメント（npm 11）で、同じ守りの設定が見つかった。公開から N 日の制限は `min-release-age`（単位は日、既定は無効）、インストール時スクリプトの許可リストは `package.json` の `allowScripts`、版の固定は `save-exact`。能力の差ではなく、既定の強さと厳しさで pnpm を選ぶ。npm は、同梱の説明に食い違いがあり、`allowScripts` が勧告にとどまってスクリプトが既定で走る版がある（止めるには `strict-allow-scripts` が要る）。pnpm は既定でインストール時スクリプトを止め、宣言していない依存を読ませない（コアが宣言外のパッケージに頼れない）。npm の設定は、どの版から使えるかを確かめられなかった。npm に切り替える理由が出たら、この ADR を supersede する。
- **1 つのパッケージにまとめる**: コアが DOM に触れないことを、型検査で保てない（`lib` や `types` はパッケージ単位の設定のため、画面と同居すると DOM の型が入る）。
