# 0023. 静的サイトを非公開の S3 と CloudFront で配信し、独自ドメインは変数で切り替える（DNS と証明書は作らない）

- **Status**: Active
- **Date**: 2026-11-06

## Context

モード 1 のサイトは、ビルドした静的ファイル（`apps/web/dist`）だけで動く（[0006](0006-product-scope-and-stages.md)）。これを AWS で公開する。公開 URL は当面 CloudFront が払い出すものでよいが、あとで独自ドメインに容易に切り替えられるようにしたい。

独自ドメインには、バージニア北部リージョン（`us-east-1`）の証明書と、DNS のレコードが要る。DNS の提供元は Route 53 とは限らず、ゾーンがこのアカウントの外にある場合もある（[0003](0003-account-agnostic.md)）。

## Decision

- ファイルは非公開の S3 バケットに置き、CloudFront の OAC（オリジンアクセスコントロール。CloudFront が SigV4 で署名して S3 を読む仕組み）からだけ読ませる。バケットポリシーは、TLS 以外の拒否と、このディストリビューションからの `s3:GetObject` の許可の 2 文だけにする。
- レスポンスヘッダポリシーを自前で作り、HSTS（`preload` なし）・`X-Content-Type-Options`・`X-Frame-Options: DENY`・`Referrer-Policy`・CSP（Content Security Policy。読み込み元の制限）を `override` で付ける。CSP は `default-src 'self'` を基本にし、`base-uri`・`form-action` も `'self'`、`frame-ancestors` と `object-src` は `'none'`。ビルド成果物が同じオリジンの JS・CSS・favicon だけを読み込み、インラインの script/style を持たないことを確かめた上での値で、確かめた内容は `infra/app/tests/headers.tftest.hcl` に書く。
- キャッシュポリシーは AWS 管理の CachingOptimized を、固定の ID で書く。
- 独自ドメインは変数 `domain_names`（別名）と `acm_certificate_arn`（`us-east-1` の証明書）で切り替える。片方だけの指定と、`us-east-1` 以外の証明書は、変数の検証で止める。未指定なら CloudFront 既定の証明書で配信する。
- DNS のレコードと ACM 証明書は、このモジュールで作らない。外で用意した証明書の ARN を渡し、`distribution_domain_name` の出力を DNS の向け先に使う。

## Consequences

- 単独のアカウントで試す人は、変数を空のまま適用すれば動く。独自ドメインを使う人は、証明書の発行と DNS の登録を自分の環境で行う。
- ヘッダを自前で持つので、画面が外部のフォントや CDN を読み込むようになったら、CSP の見直しが要る。
- 更新後の切り替えは、`assets/` 配下はファイル名のハッシュで済むが、ハッシュの付かない `index.html` は既定の保持期間（1 日）のあいだ古い版が配られるので、デプロイのたびにキャッシュの削除が要る。古い版は 90 日で消える。
- キャッシュポリシーの ID は AWS 側で変わらない前提の固定値。

## Why not

- **AWS 管理の `SecurityHeadersPolicy` を使う**: CSP が無く、`X-Frame-Options` が `SAMEORIGIN` になる。
- **証明書と Route 53 のレコードまで作る**: 証明書の作成には `us-east-1` のプロバイダの別名と DNS 検証が要り、単独のアカウントで試す人の手間が増える。DNS の提供元が Route 53 とも限らない。
- **`data` でキャッシュポリシーを引く**: デプロイ用ロールにキャッシュポリシーの読み取りの権限が要る。
- **バケットを公開して CloudFront を経由しない**: 直接アクセスでヘッダが付かず、公開範囲の管理も増える。
