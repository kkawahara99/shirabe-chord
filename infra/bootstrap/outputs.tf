# バケット名にアカウントIDが入るため sensitive にして、outputs の欄には出さない（取り出すときは terraform output -raw）。
# plan と apply の差分にはバケット名が出るので、それらの出力は貼らない
output "bucket_name" {
  description = "状態ファイル用バケットの名前。"
  value       = aws_s3_bucket.state.bucket
  sensitive   = true
}

# 本体（infra/app）の terraform init に渡す partial backend configuration。gitignore 対象の backend.app.hcl に写す
output "backend_config_example" {
  description = "backend.app.hcl に写す内容の例。"
  value       = <<-EOT
    bucket = "${aws_s3_bucket.state.bucket}"
    key = "app/terraform.tfstate"
    region = "${data.aws_region.current.region}"
    use_lockfile = true
  EOT
  sensitive   = true
}
