output "asg_name" {
  value       = aws_autoscaling_group.this.name
  description = "Auto Scaling Group name."
}

output "security_group_id" {
  value       = aws_security_group.this.id
  description = "Security group ID attached to instances."
}

output "launch_template_id" {
  value       = aws_launch_template.this.id
  description = "Launch template ID."
}
