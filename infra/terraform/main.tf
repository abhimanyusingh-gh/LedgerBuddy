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

locals {
  resolved_mongo_uri = var.provision_documentdb ? module.documentdb[0].connection_uri : var.mongo_uri
  final_ami_id       = var.ami_id != "" ? var.ami_id : data.aws_ami.amazon_linux.id
  common_tags        = { Project = var.project_name }
  worker_ingress_rules = [
    for cidr in var.api_ingress_cidrs : {
      from_port   = 4000
      to_port     = 4000
      protocol    = "tcp"
      cidr_blocks = [cidr]
    }
  ]
  app_manifest_env = coalesce(try(var.app_manifest.env, null), {})
  resolved_manifest = {
    ingestion_sources                = coalesce(try(var.app_manifest.ingestion_sources, null), var.ingestion_sources)
    ocr_provider                     = coalesce(try(var.app_manifest.ocr_provider, null), var.ocr_provider)
    confidence_expected_max_total    = coalesce(try(var.app_manifest.confidence_expected_max_total, null), var.confidence_expected_max_total)
    confidence_expected_max_due_days = coalesce(try(var.app_manifest.confidence_expected_max_due_days, null), var.confidence_expected_max_due_days)
    confidence_auto_select_min       = coalesce(try(var.app_manifest.confidence_auto_select_min, null), var.confidence_auto_select_min)
    tally_endpoint                   = coalesce(try(var.app_manifest.tally_endpoint, null), var.tally_endpoint)
    tally_company                    = coalesce(try(var.app_manifest.tally_company, null), var.tally_company)
    tally_purchase_ledger            = coalesce(try(var.app_manifest.tally_purchase_ledger, null), var.tally_purchase_ledger)
  }

  base_env = {
    NODE_ENV                         = "production"
    MONGO_URI                        = local.resolved_mongo_uri
    INGESTION_SOURCES                = local.resolved_manifest.ingestion_sources
    EMAIL_SOURCE_KEY                 = var.email_source_key
    EMAIL_HOST                       = var.email_host
    EMAIL_PORT                       = tostring(var.email_port)
    EMAIL_SECURE                     = tostring(var.email_secure)
    EMAIL_USERNAME                   = var.email_username
    EMAIL_PASSWORD                   = var.email_password
    EMAIL_MAILBOX                    = var.email_mailbox
    EMAIL_FROM_FILTER                = var.email_from_filter
    OCR_PROVIDER                     = local.resolved_manifest.ocr_provider
    CONFIDENCE_EXPECTED_MAX_TOTAL    = tostring(local.resolved_manifest.confidence_expected_max_total)
    CONFIDENCE_EXPECTED_MAX_DUE_DAYS = tostring(local.resolved_manifest.confidence_expected_max_due_days)
    CONFIDENCE_AUTO_SELECT_MIN       = tostring(local.resolved_manifest.confidence_auto_select_min)
    TALLY_ENDPOINT                   = local.resolved_manifest.tally_endpoint
    TALLY_COMPANY                    = local.resolved_manifest.tally_company
    TALLY_PURCHASE_LEDGER            = local.resolved_manifest.tally_purchase_ledger
    DEFAULT_APPROVER                 = "worker"
  }

  final_env = merge(local.base_env, local.app_manifest_env, var.extra_env)
}

module "worker_iam" {
  source = "../modules/aws_iam_instance_profile"

  name = "${var.project_name}-worker"
  tags = local.common_tags
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
  container_env         = local.final_env
  ingress_rules         = local.worker_ingress_rules
  scale_up_cron         = var.schedule_scale_up_cron
  scale_down_cron       = var.schedule_scale_down_cron
  tags                  = local.common_tags
}
