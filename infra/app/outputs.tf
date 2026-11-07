# バケット名にはアカウントIDが入るため sensitive にして、outputs の欄には出さない（取り出すときは terraform output -raw）。
# ディストリビューション ID も同じ扱いにそろえる。plan と apply の差分にはバケット名が出るので、それらの出力は貼らない
output "site_bucket_name" {
  description = "サイト用バケットの名前。ビルド成果物（apps/web/dist）の置き先。"
  value       = aws_s3_bucket.site.bucket
  sensitive   = true
}

output "distribution_id" {
  description = "CloudFront ディストリビューションの ID。デプロイ後のキャッシュ削除などに使う。"
  value       = aws_cloudfront_distribution.site.id
  sensitive   = true
}

# 独自ドメインにするときの DNS（CNAME か ALIAS）の向け先
output "distribution_domain_name" {
  description = "CloudFront が払い出すドメイン名。公開 URL、独自ドメインの DNS の向け先。"
  value       = aws_cloudfront_distribution.site.domain_name
}

# 画面のビルドに渡す値。未設定のあいだは空文字（共有のボタンを出さない）
output "cognito_domain_url" {
  description = "Cognito のホステッド UI のドメインの URL。画面のビルドに渡す。共有の部品が無いときは空文字。"
  value       = local.sharing_enabled ? "https://${var.cognito_domain_prefix}.auth.${data.aws_region.current.region}.amazoncognito.com" : ""
}

output "cognito_client_id" {
  description = "画面用のアプリクライアントの ID。画面のビルドに渡す。共有の部品が無いときは空文字。"
  value       = local.sharing_enabled ? aws_cognito_user_pool_client.web[0].id : ""
}
