output "cluster_endpoint" {
  value       = aws_docdb_cluster.this.endpoint
  description = "DocumentDB cluster endpoint."
}

output "reader_endpoint" {
  value       = aws_docdb_cluster.this.reader_endpoint
  description = "DocumentDB reader endpoint."
}

output "cluster_port" {
  value       = aws_docdb_cluster.this.port
  description = "DocumentDB cluster port."
}

output "security_group_id" {
  value       = aws_security_group.this.id
  description = "Security group ID attached to DocumentDB."
}

output "connection_uri" {
  value       = "mongodb://${var.master_username}:${urlencode(var.master_password)}@${aws_docdb_cluster.this.endpoint}:${aws_docdb_cluster.this.port}/${var.db_name}?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&authSource=admin"
  description = "Application connection URI for the cluster."
  sensitive   = true
}
