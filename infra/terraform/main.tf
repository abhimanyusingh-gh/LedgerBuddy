data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

# Module source strategy:
# - Local copy-first: ../modules/<module_name>
# - Registry migration later is mechanical: replace only `source` values below.
module "documentdb" {
  count  = var.provision_documentdb ? 1 : 0
  source = "../modules/aws_documentdb_cluster"

  name                    = "${var.project_name}-docdb"
  vpc_id                  = var.vpc_id
  subnet_ids              = var.subnet_ids
  allowed_cidr_blocks     = var.documentdb_allowed_cidrs
  master_username         = var.documentdb_master_username
  master_password         = var.documentdb_master_password
  db_name                 = var.documentdb_db_name
  engine_version          = var.documentdb_engine_version
  instance_class          = var.documentdb_instance_class
  instance_count          = var.documentdb_instance_count
  backup_retention_period = var.documentdb_backup_retention_period
  preferred_backup_window = var.documentdb_preferred_backup_window
  storage_encrypted       = var.documentdb_storage_encrypted
  deletion_protection     = var.documentdb_deletion_protection
  skip_final_snapshot     = var.documentdb_skip_final_snapshot
  apply_immediately       = var.documentdb_apply_immediately
  tags = {
    Project = var.project_name
  }
}

module "artifact_bucket" {
  count  = var.provision_artifact_bucket ? 1 : 0
  source = "../modules/aws_s3_bucket"

  bucket_name        = var.artifact_bucket_name
  force_destroy      = var.artifact_bucket_force_destroy
  versioning_enabled = var.artifact_bucket_versioning_enabled
  expiration_days    = var.artifact_bucket_expiration_days
  tags = {
    Project = var.project_name
  }
}

locals {
  sts_enabled                   = contains(["stg", "prod"], var.environment)
  common_tags                   = { Project = var.project_name }
  final_ami_id                  = var.ami_id != "" ? var.ami_id : data.aws_ami.amazon_linux.id
  resolved_mongo_uri            = var.provision_documentdb ? module.documentdb[0].connection_uri : var.mongo_uri
  resolved_artifact_bucket_name = var.provision_artifact_bucket ? module.artifact_bucket[0].bucket_name : var.artifact_bucket_name
  artifact_bucket_prefix        = trim(var.artifact_bucket_prefix, "/")
  artifact_object_arn           = local.artifact_bucket_prefix != "" ? "arn:aws:s3:::${local.resolved_artifact_bucket_name}/${local.artifact_bucket_prefix}/*" : "arn:aws:s3:::${local.resolved_artifact_bucket_name}/*"
  worker_policy_arns            = compact([try(aws_iam_policy.worker_artifact_access[0].arn, null)])
  worker_ingress_rules = [
    for cidr in var.api_ingress_cidrs : {
      from_port   = 4000
      to_port     = 4000
      protocol    = "tcp"
      cidr_blocks = [cidr]
    }
  ]

  manifest_ingestion_sources                = coalesce(try(var.app_manifest.ingestion_sources, null), var.ingestion_sources)
  manifest_ocr_provider                     = coalesce(try(var.app_manifest.ocr_provider, null), var.ocr_provider)
  manifest_confidence_expected_max_total    = coalesce(try(var.app_manifest.confidence_expected_max_total, null), var.confidence_expected_max_total)
  manifest_confidence_expected_max_due_days = coalesce(try(var.app_manifest.confidence_expected_max_due_days, null), var.confidence_expected_max_due_days)
  manifest_confidence_auto_select_min       = coalesce(try(var.app_manifest.confidence_auto_select_min, null), var.confidence_auto_select_min)
  manifest_tally_endpoint                   = coalesce(try(var.app_manifest.tally_endpoint, null), var.tally_endpoint)
  manifest_tally_company                    = coalesce(try(var.app_manifest.tally_company, null), var.tally_company)
  manifest_tally_purchase_ledger            = coalesce(try(var.app_manifest.tally_purchase_ledger, null), var.tally_purchase_ledger)

  worker_env = merge(
    {
      ENV                              = "prod"
      NODE_ENV                         = "production"
      MONGO_URI                        = local.resolved_mongo_uri
      INGESTION_SOURCES                = local.manifest_ingestion_sources
      EMAIL_SOURCE_KEY                 = var.email_source_key
      EMAIL_HOST                       = var.email_host
      EMAIL_PORT                       = tostring(var.email_port)
      EMAIL_SECURE                     = tostring(var.email_secure)
      EMAIL_USERNAME                   = var.email_username
      EMAIL_PASSWORD                   = var.email_password
      EMAIL_MAILBOX                    = var.email_mailbox
      EMAIL_FROM_FILTER                = var.email_from_filter
      OCR_PROVIDER                     = local.manifest_ocr_provider
      CONFIDENCE_EXPECTED_MAX_TOTAL    = tostring(local.manifest_confidence_expected_max_total)
      CONFIDENCE_EXPECTED_MAX_DUE_DAYS = tostring(local.manifest_confidence_expected_max_due_days)
      CONFIDENCE_AUTO_SELECT_MIN       = tostring(local.manifest_confidence_auto_select_min)
      S3_FILE_STORE_BUCKET             = local.resolved_artifact_bucket_name
      S3_FILE_STORE_REGION             = var.aws_region
      S3_FILE_STORE_PREFIX             = local.artifact_bucket_prefix
      S3_FILE_STORE_FORCE_PATH_STYLE   = "false"
      TALLY_ENDPOINT                   = local.manifest_tally_endpoint
      TALLY_COMPANY                    = local.manifest_tally_company
      TALLY_PURCHASE_LEDGER            = local.manifest_tally_purchase_ledger
      DEFAULT_APPROVER                 = "worker"
    },
    coalesce(try(var.app_manifest.env, null), {}),
    var.extra_env
  )
}

module "auth_sts_role" {
  count  = local.sts_enabled ? 1 : 0
  source = "../modules/aws_sts_access_role"

  name                     = "${var.project_name}-${var.environment}-auth-sts"
  trusted_services         = var.sts_trusted_services
  trusted_arns             = var.sts_trusted_arns
  allowed_assume_role_arns = var.sts_assume_role_arns
  tags                     = local.common_tags
}

module "backend_sts_role" {
  count  = local.sts_enabled ? 1 : 0
  source = "../modules/aws_sts_access_role"

  name                     = "${var.project_name}-${var.environment}-backend-sts"
  trusted_services         = var.sts_trusted_services
  trusted_arns             = var.sts_trusted_arns
  allowed_assume_role_arns = var.sts_assume_role_arns
  tags                     = local.common_tags
}

resource "aws_iam_policy" "worker_artifact_access" {
  count       = length(trimspace(local.resolved_artifact_bucket_name)) > 0 ? 1 : 0
  name        = "${var.project_name}-worker-artifacts"
  description = "Allow worker access to invoice artifact storage."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListArtifactsBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::${local.resolved_artifact_bucket_name}"
      },
      {
        Sid    = "ReadWriteArtifactObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts"
        ]
        Resource = local.artifact_object_arn
      }
    ]
  })
}

module "worker_iam" {
  source = "../modules/aws_iam_instance_profile"

  name        = "${var.project_name}-worker"
  policy_arns = concat(["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"], local.worker_policy_arns)
  tags        = local.common_tags
}

module "scheduled_service" {
  source = "../modules/aws_scheduled_ec2_service"

  name                  = "${var.project_name}-worker"
  vpc_id                = var.vpc_id
  subnet_ids            = var.subnet_ids
  instance_type         = var.instance_type
  ami_id                = local.final_ami_id
  key_name              = var.key_name
  market_type           = var.worker_market_type
  container_image       = var.app_image
  container_command     = "node dist/scripts/runWorkerOnce.js"
  instance_profile_name = module.worker_iam.instance_profile_name
  container_env         = local.worker_env
  ingress_rules         = local.worker_ingress_rules
  scale_up_cron         = var.schedule_scale_up_cron
  scale_down_cron       = var.schedule_scale_down_cron
  tags                  = local.common_tags
}
