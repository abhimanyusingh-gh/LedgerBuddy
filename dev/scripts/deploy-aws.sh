#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform}"
PROJECT_NAME="${PROJECT_NAME:-billforge}"
ECR_REPOSITORY="${ECR_REPOSITORY:-${PROJECT_NAME}-backend}"
TERRAFORM_AUTO_APPROVE="${TERRAFORM_AUTO_APPROVE:-true}"

fail() {
  echo "Error: $*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing required command: $command_name"
}

require_command aws
require_command docker
require_command terraform
require_command git

if [[ -z "${ENV:-}" ]]; then
  fail "ENV is required. Set ENV=stg or ENV=prod."
fi

case "$ENV" in
stg | prod)
  ;;
local)
  fail "ENV=local is Docker-only and not deployable with this AWS script."
  ;;
*)
  fail "Unknown ENV='$ENV'. Expected one of: stg, prod."
  ;;
esac

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
if [[ -z "$AWS_REGION" ]]; then
  AWS_REGION="$(aws configure get region 2>/dev/null || true)"
fi
if [[ -z "$AWS_REGION" ]]; then
  fail "AWS region is not configured. Set AWS_REGION or AWS_DEFAULT_REGION."
fi

if [[ ! -d "$TERRAFORM_DIR" ]]; then
  fail "Terraform directory not found: $TERRAFORM_DIR"
fi

TFVARS_FILE="${TFVARS_FILE:-$TERRAFORM_DIR/environments/${ENV}.tfvars}"
if [[ ! -f "$TFVARS_FILE" ]]; then
  if [[ -f "$TERRAFORM_DIR/terraform.tfvars" ]]; then
    TFVARS_FILE="$TERRAFORM_DIR/terraform.tfvars"
  else
    fail "No tfvars found. Create $TERRAFORM_DIR/environments/${ENV}.tfvars or set TFVARS_FILE."
  fi
fi

TFVARS_FILE_ABS="$(cd "$(dirname "$TFVARS_FILE")" && pwd)/$(basename "$TFVARS_FILE")"

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
AWS_CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text)"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"
IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "Deploy target:"
echo "  ENV:            $ENV"
echo "  AWS region:     $AWS_REGION"
echo "  AWS principal:  $AWS_CALLER_ARN"
echo "  Terraform vars: $TFVARS_FILE_ABS"
echo "  Image URI:      $IMAGE_URI"

if ! aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "ECR repository '$ECR_REPOSITORY' not found. Creating it."
  aws ecr create-repository --repository-name "$ECR_REPOSITORY" --region "$AWS_REGION" >/dev/null
fi

echo "Logging Docker into ECR registry $ECR_REGISTRY"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null

echo "Building and pushing backend image"
if docker buildx version >/dev/null 2>&1; then
  docker buildx build \
    --platform linux/amd64 \
    --file backend/Dockerfile \
    --tag "$IMAGE_URI" \
    --push \
    .
else
  echo "docker buildx not available; using docker build with linux/amd64 default platform"
  DOCKER_DEFAULT_PLATFORM=linux/amd64 docker build --file backend/Dockerfile --tag "$IMAGE_URI" .
  docker push "$IMAGE_URI"
fi

echo "Running Terraform init/validate/plan/apply"
terraform -chdir="$TERRAFORM_DIR" init -input=false
terraform -chdir="$TERRAFORM_DIR" validate

PLAN_FILE="$(mktemp -t billforge-plan.XXXXXX)"
cleanup() {
  rm -f "$PLAN_FILE"
}
trap cleanup EXIT

terraform -chdir="$TERRAFORM_DIR" plan \
  -input=false \
  -var-file="$TFVARS_FILE_ABS" \
  -var="aws_region=${AWS_REGION}" \
  -var="environment=${ENV}" \
  -var="app_image=${IMAGE_URI}" \
  -out="$PLAN_FILE"

if [[ "$TERRAFORM_AUTO_APPROVE" == "true" ]]; then
  terraform -chdir="$TERRAFORM_DIR" apply -input=false -auto-approve "$PLAN_FILE"
else
  terraform -chdir="$TERRAFORM_DIR" apply -input=false "$PLAN_FILE"
fi

echo "Deployment completed successfully."
echo "Deployed backend image: $IMAGE_URI"
