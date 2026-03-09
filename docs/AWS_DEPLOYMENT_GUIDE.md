# AWS Deployment Guide (Junior-Friendly)

This guide deploys the backend worker on AWS Spot instances and a production DocumentDB cluster using Terraform.

## 1. Prerequisites

- AWS account with access to EC2, Auto Scaling, IAM, and ECR.
- Existing VPC and at least 2 private/public subnets.
- If you are not provisioning DocumentDB, an external MongoDB connection string (Atlas or self-hosted).
- Terraform `>= 1.6` (matches `infra/terraform/versions.tf`).
- AWS CLI configured (`aws configure`).
- Docker and Yarn installed locally.

## Quick Deploy Script (Recommended)

Run one command from repo root to build, push, and apply:

```bash
ENV=stg \
AWS_REGION=us-east-1 \
TFVARS_FILE=infra/terraform/environments/stg.tfvars \
bash ./scripts/deploy-aws.sh
```

The script performs:
- AWS credential validation (`aws sts get-caller-identity`)
- backend image build for `linux/amd64`
- ECR repository create-if-missing + image push
- Terraform `init`, `validate`, `plan`, and `apply` with the pushed image URI

Optional overrides:
- `PROJECT_NAME` (default `billforge`)
- `ECR_REPOSITORY` (default `${PROJECT_NAME}-backend`)
- `IMAGE_TAG` (default `<git-sha>-<timestamp>`)
- `TERRAFORM_DIR` (default `infra/terraform`)
- `TERRAFORM_AUTO_APPROVE` (`true`/`false`, default `true`)

## 2. Build and Push Backend Image to ECR

1. Create ECR repo (one time):
```bash
aws ecr create-repository --repository-name billforge-backend --region <AWS_REGION>
```

2. Authenticate Docker to ECR:
```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

3. Build and push image:
```bash
docker build -t billforge-backend -f backend/Dockerfile .
docker tag billforge-backend:latest <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/billforge-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/billforge-backend:latest
```

## 3. Configure Terraform Variables

1. Move to Terraform folder:
```bash
cd infra/terraform
```

Reusable module catalog lives in:
- `infra/modules/aws_iam_instance_profile`
- `infra/modules/aws_scheduled_ec2_service`
- `infra/modules/aws_documentdb_cluster`
- `infra/modules/aws_s3_bucket`

2. Copy production vars template:
```bash
cp environments/prod.tfvars.example terraform.tfvars
```

3. Edit `terraform.tfvars`:
- `aws_region`, `vpc_id`, `subnet_ids`
- `app_image` (your ECR image URI)
- Database mode:
  - Production standard: `provision_documentdb=true` and `documentdb_*` values (module-managed DB)
  - Worker runtime uses the module output (`effective_mongo_uri`) automatically.
- Email source values (`email_host`, `email_username`, `email_password`, etc.)
- Keep email variables populated even if your current run mode is folder-only (the current Terraform input schema requires these fields).
- OCR provider mode (`ocr_provider`) and credentials:
  - `ocr_provider="auto"` or `ocr_provider="deepseek"` routes OCR through DeepSeek-OCR
  - `ocr_provider="mock"` forces Mock OCR
  - DeepSeek values are passed via `extra_env` (see snippet below)
- Tally connection values (`tally_endpoint`, `tally_company`, `tally_purchase_ledger`)
- Scale schedule cron values
- Optional composable overrides:
  - set `app_manifest` object in tfvars to define app-level runtime overrides without changing reusable module wiring

Minimal `extra_env` example for DeepSeek:
```hcl
extra_env = {
  ENV = "prod"
  DEEPSEEK_BASE_URL  = "http://your-invoice-ocr-endpoint:8000/v1"
  DEEPSEEK_OCR_MODEL = "invoice-ocr-model"
  DEEPSEEK_TIMEOUT_MS = "3600000"
  # DEEPSEEK_API_KEY = "set-only-if-endpoint-requires-auth"
  FIELD_VERIFIER_BASE_URL = "http://your-invoice-slm-endpoint:8100/v1"
}
```

In `ENV=prod`, backend stays abstraction-based and routes OCR/SLM to remote providers.
No local MLX runtime containers are required in production deployment.

Optional `app_manifest` block:
```hcl
app_manifest = {
  ingestion_sources = "email"
  ocr_provider      = "deepseek"
  env = {
    DEFAULT_TENANT_ID     = "tenant-default"
    DEFAULT_WORKLOAD_TIER = "standard"
  }
}
```

If you want backend runtime manifest composition, bake a JSON file into the image (for example `/app/backend/runtime-manifest.prod.json`) and pass:
```hcl
extra_env = {
  APP_MANIFEST_PATH = "/app/backend/runtime-manifest.prod.json"
}
```

Minimal DocumentDB block:
```hcl
provision_documentdb = true
documentdb_allowed_cidrs        = ["10.0.0.0/16"]
documentdb_master_username      = "invoice_admin"
documentdb_master_password      = "replace-with-strong-password"
documentdb_db_name              = "billforge"
documentdb_instance_class       = "db.t3.medium"
documentdb_instance_count       = 1
documentdb_deletion_protection  = true
documentdb_skip_final_snapshot  = false
```

4. Run local quality gate before deploy:
```bash
cd ../..
yarn run quality:check
```
This must pass before image build/push.

## 4. Deploy Infrastructure

```bash
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

## 5. Verify Deployment

1. In AWS Console, confirm these resources exist:
- Launch template
- Auto Scaling Group (desired capacity 0 by default)
- IAM role + instance profile (from reusable `aws_iam_instance_profile` module)
- Worker security group
- DocumentDB cluster
- DocumentDB subnet group
- DocumentDB security group

2. Trigger one run immediately (optional):
```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name billforge-worker-asg \
  --desired-capacity 1 \
  --min-size 0 \
  --max-size 1 \
  --region <AWS_REGION>
```

The instance starts, runs `node dist/scripts/runWorkerOnce.js`, then shuts down.

3. Validate data in MongoDB:
- New invoices appear
- `parsed.totalAmountMinor` is an integer (minor currency unit)
- Checkpoints update in the `checkpoints` collection
- OCR engine is stored in `ocrProvider`; extraction source is in `metadata.extractionSource`.

4. Validate Terraform outputs:
```bash
terraform output worker_asg_name
terraform output documentdb_cluster_endpoint
terraform output -raw effective_mongo_uri
```
With the production template, `provision_documentdb=true` by default and `effective_mongo_uri` points to the provisioned DocumentDB cluster.

## 6. Day-2 Operations

- Rotate email/Tally credentials by updating `terraform.tfvars` and re-running `terraform apply`.
- Update backend code by pushing a new Docker image tag and updating `app_image`.
- Adjust frequency by changing `schedule_scale_up_cron` and `schedule_scale_down_cron`.

## 7. Rollback

- Revert `app_image` to previous tag in `terraform.tfvars`.
- Run:
```bash
terraform apply
```

## 8. Destroy (Non-Production Only)

```bash
terraform destroy
```
