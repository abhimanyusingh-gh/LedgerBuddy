output "bucket_name" {
  value       = aws_s3_bucket.this.bucket
  description = "Bucket name."
}

output "bucket_arn" {
  value       = aws_s3_bucket.this.arn
  description = "Bucket ARN."
}

output "region" {
  value       = data.aws_region.current.id
  description = "AWS region where bucket is created."
}
