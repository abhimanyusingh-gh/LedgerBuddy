output "keycloak_url" {
  value       = var.certificate_arn != "" ? "https://${aws_lb.this.dns_name}" : "http://${aws_lb.this.dns_name}"
  description = "URL of the Keycloak service via the load balancer."
}

output "task_definition_arn" {
  value       = aws_ecs_task_definition.this.arn
  description = "ARN of the Keycloak ECS task definition."
}

output "ecs_service_name" {
  value       = aws_ecs_service.this.name
  description = "Name of the ECS service running Keycloak."
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "Name of the ECS cluster."
}

output "alb_dns_name" {
  value       = aws_lb.this.dns_name
  description = "DNS name of the Application Load Balancer."
}

output "alb_zone_id" {
  value       = aws_lb.this.zone_id
  description = "Hosted zone ID of the Application Load Balancer (for Route 53 alias records)."
}

output "security_group_id" {
  value       = aws_security_group.keycloak_task.id
  description = "Security group ID attached to the Keycloak ECS tasks."
}
