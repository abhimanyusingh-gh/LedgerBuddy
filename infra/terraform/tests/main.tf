###############################################################################
# LocalStack integration test configuration
#
# Tests only LocalStack-compatible modules: S3, IAM, and STS.
# DocumentDB and EC2 scheduling are excluded (not supported by free tier).
###############################################################################

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3  = "http://localhost:4566"
    iam = "http://localhost:4566"
    sts = "http://localhost:4566"
  }

  # LocalStack requires path-style addressing for S3
  s3_use_path_style = true
}

# ---------------------------------------------------------------------------
# S3 bucket module
# ---------------------------------------------------------------------------
module "test_bucket" {
  source = "./modules/aws_s3_bucket"

  bucket_name        = "localstack-test-artifacts"
  force_destroy      = true
  versioning_enabled = true
  expiration_days    = 30

  tags = {
    Environment = "test"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# IAM instance profile module
# ---------------------------------------------------------------------------
module "test_iam_profile" {
  source = "./modules/aws_iam_instance_profile"

  name        = "localstack-test-worker"
  policy_arns = [] # LocalStack free tier has limited managed-policy support

  tags = {
    Environment = "test"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# STS access role module
# ---------------------------------------------------------------------------
module "test_sts_role" {
  source = "./modules/aws_sts_access_role"

  name             = "localstack-test-sts-role"
  trusted_services = ["ec2.amazonaws.com"]
  trusted_arns     = []

  tags = {
    Environment = "test"
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Outputs used by the test script for verification
# ---------------------------------------------------------------------------
output "s3_bucket_name" {
  value = module.test_bucket.bucket_name
}

output "s3_bucket_arn" {
  value = module.test_bucket.bucket_arn
}

output "s3_bucket_region" {
  value = module.test_bucket.region
}

output "iam_role_name" {
  value = module.test_iam_profile.role_name
}

output "iam_instance_profile_name" {
  value = module.test_iam_profile.instance_profile_name
}

output "sts_role_name" {
  value = module.test_sts_role.role_name
}

output "sts_role_arn" {
  value = module.test_sts_role.role_arn
}
