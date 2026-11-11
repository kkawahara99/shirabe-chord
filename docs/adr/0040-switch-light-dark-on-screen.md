# 0040. ライト／ダークを画面で切り替え、選びを localStorage に覚える

- **Status**: Active
- **Date**: 2026-11-11

## Context

配色は OS の設定（`prefers-color-scheme`）に従うだけで、画面からは変えられなかった。OS の設定を変えずに、このサイトだけ明暗を選べるようにしたい。

## Decision

- ヘッダーに切り替えのボタン（`ThemeToggle`）を置く。最初は OS に従い、押すと反対側を選んで `localStorage` に覚え、`<html data-theme="light|dark">` に反映する。
- CSS は、OS が暗いときの規則を `:root:not([data-theme="light"])` にし、画面で「ダーク」を選んだとき用に `:root[data-theme="dark"]` を足す。暗い値は 2 か所に持つので、`dark-mode.test.ts` が一致を守る。
- 起動時に `main.tsx` が描く前に反映する。CSP（[0023](0023-static-site-delivery-with-cloudfront-and-s3.md)）でインラインのスクリプトは使えず、`index.html` には置けない。
- 覚えるのは配色だけ。サーバーには送らず、プライバシーのページ（[0037](0037-static-privacy-page-without-contact.md)）に書く。

## Consequences

- 選んだ配色はタブを閉じても残る。保存できない環境でも、その場の切り替えは動く。
- 描く前の反映は JS が読み込まれてからなので、OS と選びが逆のとき、読み込み中に一瞬だけ OS の色が見える。
- プライバシーのページ（静的）は OS の設定にしか従わず、画面の選びには合わせない。印刷は常に白地。

## Why not

- **自動・ライト・ダークの 3 択**: 押す回数と説明が増える。選びを消して OS に戻す需要は薄いとみた。要るなら足す。
- **`sessionStorage` に覚える**: 他の画面の状態と揃うが、タブを開くたびに選び直しになる。
- **暗い値を 1 か所にする**（JS が常に `data-theme` を付ける、または `light-dark()` を使う）: JS が動く前の描画が崩れる／色の定義の書き換えが大きい。値の食い違いはテストが見つけるので、2 か所の複製で足りるとみた。
- **`<script>` をインラインで置いて一瞬の色違いを消す**: CSP を緩めることになる。
