variable "aws_region" {
  type        = string
  description = "AWS region where infrastructure should be deployed."
}

variable "environment" {
  type        = string
  description = "Deployment environment."
  default     = "local"

  validation {
    condition     = contains(["local", "stg", "prod"], var.environment)
    error_message = "environment must be one of: local, stg, prod."
  }
}

variable "project_name" {
  type        = string
  description = "Project name used for naming/tagging resources."
  default     = "billforge"
}

variable "sts_trusted_services" {
  type        = list(string)
  description = "Service principals allowed to assume auth/backend STS access roles."
  default     = ["ecs-tasks.amazonaws.com"]
}

variable "sts_trusted_arns" {
  type        = list(string)
  description = "Optional IAM principal ARNs allowed to assume auth/backend STS access roles."
  default     = []
}

variable "sts_assume_role_arns" {
  type        = list(string)
  description = "Role ARNs that auth/backend roles can assume via STS in stg/prod."
  default     = []
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for deploying spot worker instances."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets where the spot worker ASG can launch instances."
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for worker nodes."
  default     = "t3.small"
}

variable "worker_market_type" {
  type        = string
  description = "EC2 market type for worker compute: 'spot' or 'on-demand'."
  default     = "spot"

  validation {
    condition     = contains(["spot", "on-demand"], var.worker_market_type)
    error_message = "worker_market_type must be either 'spot' or 'on-demand'."
  }
}

variable "provision_artifact_bucket" {
  type        = bool
  description = "Whether Terraform should provision a reusable S3 bucket for OCR artifacts."
  default     = true
}

variable "artifact_bucket_name" {
  type        = string
  description = "S3 bucket name used for invoice artifacts (provisioned or pre-existing)."

  validation {
    condition     = length(trimspace(var.artifact_bucket_name)) > 0
    error_message = "artifact_bucket_name must be set."
  }
}

variable "artifact_bucket_prefix" {
  type        = string
  description = "Object key prefix used by backend when persisting OCR artifacts."
  default     = "invoice-artifacts"
}

variable "artifact_bucket_force_destroy" {
  type        = bool
  description = "Allow destroying provisioned artifact bucket with non-empty contents."
  default     = false
}

variable "artifact_bucket_versioning_enabled" {
  type        = bool
  description = "Enable versioning on the provisioned artifact bucket."
  default     = true
}

variable "artifact_bucket_expiration_days" {
  type        = number
  description = "Optional lifecycle expiration for provisioned artifact objects; set 0 to disable."
  default     = 0
}

variable "ami_id" {
  type        = string
  description = "Optional AMI id override. Leave blank to use latest Amazon Linux 2023."
  default     = ""
}

variable "key_name" {
  type        = string
  description = "Optional SSH key pair name."
  default     = ""
}

variable "app_image" {
  type        = string
  description = "Docker image URL for the backend worker image."
}

variable "mongo_uri" {
  type        = string
  description = "MongoDB connection string used by worker runs. Required when provision_documentdb is false."
  default     = ""
  sensitive   = true
}

variable "ingestion_sources" {
  type        = string
  description = "Comma-separated list of configured ingestion source types."
  default     = "email"
}

variable "email_source_key" {
  type        = string
  description = "Logical key for email source checkpoint partition."
  default     = "inbox-main"
}

variable "email_host" {
  type        = string
  description = "IMAP host for email ingestion."
}

variable "email_port" {
  type        = number
  description = "IMAP port."
  default     = 993
}

variable "email_secure" {
  type        = bool
  description = "Whether IMAP should use TLS."
  default     = true
}

variable "email_username" {
  type        = string
  description = "Email username for IMAP auth."
}

variable "email_password" {
  type        = string
  description = "Email password/app password for IMAP auth."
  sensitive   = true
}

variable "email_mailbox" {
  type        = string
  description = "Mailbox folder name to read."
  default     = "INBOX"
}

variable "email_from_filter" {
  type        = string
  description = "Optional sender filter for ingestion."
  default     = ""
}

variable "ocr_provider" {
  type        = string
  description = "OCR provider selected by backend."
  default     = "deepseek"
}

variable "tally_endpoint" {
  type        = string
  description = "Tally HTTP integration endpoint."
}

variable "tally_company" {
  type        = string
  description = "Tally company name used during export."
}

variable "tally_purchase_ledger" {
  type        = string
  description = "Purchase ledger name in Tally used for invoice import balancing entry."
  default     = "Purchase"
}

variable "schedule_scale_up_cron" {
  type        = string
  description = "UTC cron expression to scale worker ASG up to 1 instance."
  default     = "0 1 * * *"
}

variable "schedule_scale_down_cron" {
  type        = string
  description = "UTC cron expression to scale worker ASG down to 0 instance."
  default     = "30 1 * * *"
}

variable "api_ingress_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to reach API port 4000 on worker instance (if API is enabled on image)."
  default     = []
}

variable "extra_env" {
  type        = map(string)
  description = "Additional environment variables injected into the worker container."
  default     = {}
}

variable "app_manifest" {
  type = object({
    ingestion_sources                = optional(string)
    ocr_provider                     = optional(string)
    tally_endpoint                   = optional(string)
    tally_company                    = optional(string)
    tally_purchase_ledger            = optional(string)
    env                              = optional(map(string))
  })
  description = "Optional app-level manifest overrides for reusable module wiring."
  default     = {}
}

variable "provision_documentdb" {
  type        = bool
  description = "Whether Terraform should provision and use a DocumentDB cluster for production."
  default     = false
}

variable "documentdb_allowed_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to access DocumentDB on port 27017. Required when provision_documentdb is true."
  default     = []
}

variable "documentdb_master_username" {
  type        = string
  description = "Master username for the provisioned DocumentDB cluster."
  default     = "invoice_admin"
}

variable "documentdb_master_password" {
  type        = string
  description = "Master password for the provisioned DocumentDB cluster (12+ chars). Required when provision_documentdb is true."
  default     = ""
  sensitive   = true
}

variable "documentdb_db_name" {
  type        = string
  description = "Database name used in the generated DocumentDB connection URI."
  default     = "billforge"
}

variable "documentdb_engine_version" {
  type        = string
  description = "Engine version for DocumentDB."
  default     = "5.0.0"
}

variable "documentdb_instance_class" {
  type        = string
  description = "Instance class for DocumentDB instances."
  default     = "db.t3.medium"
}

variable "documentdb_instance_count" {
  type        = number
  description = "Number of DocumentDB instances in the cluster."
  default     = 1
}

variable "documentdb_backup_retention_period" {
  type        = number
  description = "Backup retention period in days for DocumentDB."
  default     = 7
}

variable "documentdb_preferred_backup_window" {
  type        = string
  description = "Preferred backup window for DocumentDB in UTC."
  default     = "07:00-09:00"
}

variable "documentdb_storage_encrypted" {
  type        = bool
  description = "Whether DocumentDB storage is encrypted."
  default     = true
}

variable "documentdb_deletion_protection" {
  type        = bool
  description = "Whether DocumentDB deletion protection is enabled."
  default     = true
}

variable "documentdb_skip_final_snapshot" {
  type        = bool
  description = "Whether to skip final snapshot for DocumentDB on destroy."
  default     = false
}

variable "documentdb_apply_immediately" {
  type        = bool
  description = "Whether DocumentDB changes are applied immediately."
  default     = true
}
