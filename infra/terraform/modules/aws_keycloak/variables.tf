variable "name" {
  type        = string
  description = "Name prefix for all Keycloak resources."
  default     = "billforge-keycloak"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where Keycloak resources are deployed."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the ECS tasks."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for the Application Load Balancer."
}

variable "keycloak_image" {
  type        = string
  description = "Keycloak container image."
  default     = "quay.io/keycloak/keycloak:26.0"
}

variable "keycloak_admin_password" {
  type        = string
  description = "Password for the Keycloak bootstrap admin user."
  sensitive   = true
}

variable "keycloak_db_url" {
  type        = string
  description = "JDBC connection URL for the Keycloak database (e.g. jdbc:postgresql://host:5432/keycloak)."
}

variable "keycloak_db_username" {
  type        = string
  description = "Database username for Keycloak."
}

variable "keycloak_db_password" {
  type        = string
  description = "Database password for Keycloak."
  sensitive   = true
}

variable "cpu" {
  type        = number
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  default     = 1024
}

variable "memory" {
  type        = number
  description = "Fargate task memory in MiB."
  default     = 2048
}

variable "desired_count" {
  type        = number
  description = "Number of Keycloak tasks to run."
  default     = 1
}

variable "container_port" {
  type        = number
  description = "Port the Keycloak container listens on."
  default     = 8080
}

variable "health_check_path" {
  type        = string
  description = "HTTP health check path for the ALB target group."
  default     = "/health/ready"
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN for HTTPS on the ALB. Leave empty to use HTTP only."
  default     = ""
}

variable "allowed_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to reach the ALB."
  default     = ["0.0.0.0/0"]
}

variable "keycloak_hostname" {
  type        = string
  description = "Public hostname for Keycloak (used for KC_HOSTNAME). Leave empty to allow any."
  default     = ""
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources."
  default     = {}
}
