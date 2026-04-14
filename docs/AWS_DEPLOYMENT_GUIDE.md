# AWS Deployment Guide

This guide deploys BillForge on AWS using Spot instances, DocumentDB, and S3. Authentication is handled exclusively by Keycloak (OIDC).

## 1. Prerequisites

- AWS account with access to EC2, Auto Scaling, IAM, and ECR.
- Existing VPC and at least 2 private/public subnets.
- If you are not provisioning DocumentDB, an external MongoDB connection string (Atlas or self-hosted).
- A running Keycloak instance (realm `billforge`, client `billforge-app`, port 8180 in production).
- Terraform `>= 1.6` (matches `infra/terraform/versions.tf`).
- AWS CLI configured (`aws configure`).
- Docker and Yarn installed locally.

## Quick Deploy Script (Recommended)

Run one command from repo root to build, push, and apply:

```bash
ENV=stg \
AWS_REGION=us-east-1 \
TFVARS_FILE=infra/terraform/environments/stg.tfvars \
bash ./dev/scripts/deploy-aws.sh
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
- Keycloak OIDC settings (see `extra_env` below)
- Email source values (`email_host`, `email_username`, `email_password`, etc.)
- Keep email variables populated even if your current run mode is folder-only (the current Terraform input schema requires these fields).
- OCR provider mode (`ocr_provider`) and credentials:
  - `ocr_provider="auto"` or `ocr_provider="deepseek"` routes OCR through DeepSeek-OCR
  - `ocr_provider="llamaparse"` routes OCR through LlamaParse (requires `LLAMA_CLOUD_API_KEY`)
  - `ocr_provider="mock"` forces Mock OCR
- Tally connection values (`tally_endpoint`, `tally_company`, `tally_purchase_ledger`)
- Scale schedule cron values
- Optional composable overrides:
  - set `app_manifest` object in tfvars to define app-level runtime overrides without changing reusable module wiring

### Authentication Environment Variables (Keycloak OIDC)

BillForge authenticates exclusively through Keycloak. The following OIDC variables must be set:

| Variable | Description | Example |
|----------|-------------|---------|
| `OIDC_ISSUER_URL` | Keycloak realm issuer | `https://auth.example.com/realms/billforge` |
| `OIDC_CLIENT_ID` | OIDC client identifier | `billforge-app` |
| `OIDC_CLIENT_SECRET` | OIDC client secret | (from Keycloak admin console) |
| `OIDC_AUTH_URL` | Authorization endpoint | `https://auth.example.com/realms/billforge/protocol/openid-connect/auth` |
| `OIDC_TOKEN_URL` | Token endpoint | `https://auth.example.com/realms/billforge/protocol/openid-connect/token` |
| `OIDC_VALIDATE_URL` | Token introspection endpoint | `https://auth.example.com/realms/billforge/protocol/openid-connect/token/introspect` |
| `OIDC_USERINFO_URL` | UserInfo endpoint | `https://auth.example.com/realms/billforge/protocol/openid-connect/userinfo` |
| `OIDC_REDIRECT_URI` | OAuth callback URI | `https://app.example.com/api/auth/callback` |
| `AUTH_AUTO_PROVISION_USERS` | Auto-create MongoDB user on first Keycloak login | `true` |
| `KEYCLOAK_INTERNAL_BASE_URL` | Keycloak base URL for server-to-server calls | `http://keycloak:8080` |
| `KEYCLOAK_REALM` | Keycloak realm name | `billforge` |

### OCR and Extraction Provider Variables

| Variable | Description | Required When |
|----------|-------------|---------------|
| `OCR_PROVIDER` | Provider selection: `auto`, `deepseek`, `llamaparse`, `mock` | Always |
| `OCR_PROVIDER_BASE_URL` | DeepSeek OCR endpoint | `ocr_provider=auto` or `deepseek` |
| `OCR_MODEL` | DeepSeek model name | DeepSeek provider |
| `OCR_TIMEOUT_MS` | OCR request timeout | Always (default 3600000) |
| `LLAMA_CLOUD_API_KEY` | LlamaCloud API key | `ocr_provider=llamaparse` or LlamaExtract |
| `LLAMA_PARSE_EXTRACT_ENABLED` | Enable LlamaExtract for extraction (bypasses SLM) | LlamaExtract mode |
| `LLAMA_PARSE_EXTRACT_TIER` | LlamaExtract tier: `cost_effective` or `agentic` | LlamaExtract mode |
| `FIELD_VERIFIER_PROVIDER` | SLM provider: `http` or `none` | Always |
| `FIELD_VERIFIER_BASE_URL` | SLM service endpoint | `FIELD_VERIFIER_PROVIDER=http` |

Minimal `extra_env` example for production:
```hcl
extra_env = {
  ENV = "prod"

  OIDC_CLIENT_ID          = "billforge-app"
  OIDC_CLIENT_SECRET      = "your-keycloak-client-secret"
  OIDC_AUTH_URL            = "https://auth.example.com/realms/billforge/protocol/openid-connect/auth"
  OIDC_TOKEN_URL           = "https://auth.example.com/realms/billforge/protocol/openid-connect/token"
  OIDC_VALIDATE_URL        = "https://auth.example.com/realms/billforge/protocol/openid-connect/token/introspect"
  OIDC_USERINFO_URL        = "https://auth.example.com/realms/billforge/protocol/openid-connect/userinfo"
  OIDC_REDIRECT_URI        = "https://app.example.com/api/auth/callback"
  AUTH_AUTO_PROVISION_USERS = "true"
  KEYCLOAK_INTERNAL_BASE_URL = "http://keycloak:8080"
  KEYCLOAK_REALM           = "billforge"

  OCR_PROVIDER             = "deepseek"
  OCR_PROVIDER_BASE_URL    = "http://your-ocr-endpoint:8000/v1"
  OCR_MODEL                = "ocr-model"
  OCR_TIMEOUT_MS           = "3600000"

  FIELD_VERIFIER_PROVIDER  = "http"
  FIELD_VERIFIER_BASE_URL  = "http://your-slm-endpoint:8100/v1"
}
```

In `ENV=prod`, backend routes OCR/SLM to remote providers. No local MLX runtime containers are required in production deployment.

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

## 4. Service Ports Reference

| Service | Internal Port | Default Exposed Port |
|---------|--------------|---------------------|
| Backend | 4000 | 4100 |
| Frontend | 80 | 5177 (dev: 3000) |
| Keycloak | 8080 | 8180 (dev: 8280) |
| MongoDB | 27017 | 27018 |
| MinIO (S3 API) | 9000 | 9100 |
| MinIO Console | 9001 | 9101 |
| OCR (Docker proxy) | 8000 | 8202 |
| SLM (Docker proxy) | 8100 | 8302 |

## 5. Deploy Infrastructure

```bash
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

## 6. Verify Deployment

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

## 7. Day-2 Operations

- Rotate Keycloak client secrets by updating `OIDC_CLIENT_SECRET` in `extra_env` and re-running `terraform apply`.
- Rotate email/Tally credentials by updating `terraform.tfvars` and re-running `terraform apply`.
- Update backend code by pushing a new Docker image tag and updating `app_image`.
- Adjust frequency by changing `schedule_scale_up_cron` and `schedule_scale_down_cron`.

## 8. Rollback

- Revert `app_image` to previous tag in `terraform.tfvars`.
- Run:
```bash
terraform apply
```

## 9. Destroy (Non-Production Only)

```bash
terraform destroy
```
