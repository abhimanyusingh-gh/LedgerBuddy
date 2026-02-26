output "worker_asg_name" {
  value       = module.scheduled_service.asg_name
  description = "Auto Scaling Group name for scheduled invoice workers."
}

output "worker_security_group_id" {
  value       = module.scheduled_service.security_group_id
  description = "Security group attached to worker instances."
}

output "worker_iam_role_name" {
  value       = module.worker_iam.role_name
  description = "IAM role used by worker instances."
}

output "worker_instance_profile_name" {
  value       = module.worker_iam.instance_profile_name
  description = "IAM instance profile attached to worker launch template."
}

output "effective_mongo_uri" {
  value       = local.resolved_mongo_uri
  description = "Effective Mongo URI injected into worker runtime."
  sensitive   = true
}

output "documentdb_cluster_endpoint" {
  value       = try(module.documentdb[0].cluster_endpoint, null)
  description = "Provisioned DocumentDB cluster endpoint, if enabled."
}

output "documentdb_reader_endpoint" {
  value       = try(module.documentdb[0].reader_endpoint, null)
  description = "Provisioned DocumentDB reader endpoint, if enabled."
}

output "documentdb_security_group_id" {
  value       = try(module.documentdb[0].security_group_id, null)
  description = "Provisioned DocumentDB security group ID, if enabled."
}

output "artifact_bucket_name" {
  value       = local.resolved_artifact_bucket_name
  description = "S3 bucket used for OCR crop and preview artifacts."
}

output "artifact_bucket_arn" {
  value       = try(module.artifact_bucket[0].bucket_arn, null)
  description = "ARN of provisioned artifact bucket, if managed by this stack."
}
