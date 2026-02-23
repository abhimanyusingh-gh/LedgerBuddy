output "role_name" {
  value       = aws_iam_role.this.name
  description = "IAM role name."
}

output "instance_profile_name" {
  value       = aws_iam_instance_profile.this.name
  description = "IAM instance profile name."
}
