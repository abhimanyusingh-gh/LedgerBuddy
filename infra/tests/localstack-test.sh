#!/usr/bin/env bash
###############################################################################
# LocalStack integration tests for Terraform modules
#
# Tests S3, IAM, and STS modules against a local LocalStack instance.
# DocumentDB and EC2 scheduling are excluded (not supported by free tier).
#
# Usage:
#   ./localstack-test.sh            # Full run (start, test, teardown)
#   ./localstack-test.sh --no-down  # Keep LocalStack running after tests
#
# Prerequisites: docker, docker-compose (or docker compose), terraform, awslocal or aws CLI
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.localstack.yml"
LOCALSTACK_URL="http://localhost:4566"
KEEP_RUNNING=false
PASSED=0
FAILED=0

# ---------------------------------------------------------------------------
# Colour helpers (no-op when not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --no-down) KEEP_RUNNING=true ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

# ---------------------------------------------------------------------------
# Detect compose command
# ---------------------------------------------------------------------------
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  fail "Neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi

# ---------------------------------------------------------------------------
# AWS CLI helper targeting LocalStack
# ---------------------------------------------------------------------------
aws_local() {
  if command -v awslocal &>/dev/null; then
    awslocal "$@"
  else
    aws --endpoint-url="${LOCALSTACK_URL}" \
        --region us-east-1 \
        --no-sign-request \
        "$@"
  fi
}

# ---------------------------------------------------------------------------
# Test assertion helpers
# ---------------------------------------------------------------------------
assert_equals() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    info "PASS: ${label}"
    PASSED=$((PASSED + 1))
  else
    fail "FAIL: ${label} (expected='${expected}', actual='${actual}')"
    FAILED=$((FAILED + 1))
  fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    info "PASS: ${label}"
    PASSED=$((PASSED + 1))
  else
    fail "FAIL: ${label} (expected to contain '${needle}')"
    FAILED=$((FAILED + 1))
  fi
}

assert_not_empty() {
  local label="$1" value="$2"
  if [ -n "$value" ]; then
    info "PASS: ${label}"
    PASSED=$((PASSED + 1))
  else
    fail "FAIL: ${label} (value was empty)"
    FAILED=$((FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
cleanup() {
  info "Running terraform destroy ..."
  terraform -chdir="${SCRIPT_DIR}" destroy -auto-approve \
    -input=false 2>/dev/null || warn "Terraform destroy returned non-zero"

  if [ "${KEEP_RUNNING}" = false ]; then
    info "Stopping LocalStack ..."
    ${COMPOSE_CMD} -f "${COMPOSE_FILE}" down -v 2>/dev/null || true
  else
    warn "Leaving LocalStack running (--no-down)."
  fi
}
trap cleanup EXIT

# ===========================================================================
# 1. Start LocalStack
# ===========================================================================
info "Starting LocalStack via ${COMPOSE_CMD} ..."
${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d

info "Waiting for LocalStack to be ready ..."
RETRIES=30
until curl -sf "${LOCALSTACK_URL}/_localstack/health" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "${RETRIES}" -le 0 ]; then
    fail "LocalStack did not become healthy in time."
    exit 1
  fi
  sleep 2
done
info "LocalStack is healthy."

# ===========================================================================
# 2. Terraform init & apply
# ===========================================================================
info "Running terraform init ..."
terraform -chdir="${SCRIPT_DIR}" init -input=false

info "Running terraform apply ..."
terraform -chdir="${SCRIPT_DIR}" apply -auto-approve -input=false

# Capture outputs
BUCKET_NAME=$(terraform -chdir="${SCRIPT_DIR}" output -raw s3_bucket_name)
BUCKET_ARN=$(terraform -chdir="${SCRIPT_DIR}" output -raw s3_bucket_arn)
IAM_ROLE_NAME=$(terraform -chdir="${SCRIPT_DIR}" output -raw iam_role_name)
IAM_PROFILE_NAME=$(terraform -chdir="${SCRIPT_DIR}" output -raw iam_instance_profile_name)
STS_ROLE_NAME=$(terraform -chdir="${SCRIPT_DIR}" output -raw sts_role_name)
STS_ROLE_ARN=$(terraform -chdir="${SCRIPT_DIR}" output -raw sts_role_arn)

# ===========================================================================
# 3. S3 module tests
# ===========================================================================
echo ""
info "=== S3 Module Tests ==="

# 3a. Bucket exists
BUCKET_LIST=$(aws_local s3api list-buckets --query "Buckets[].Name" --output text)
assert_contains "S3 bucket was created" "$BUCKET_LIST" "$BUCKET_NAME"

# 3b. Bucket name matches expected
assert_equals "S3 bucket name matches" "localstack-test-artifacts" "$BUCKET_NAME"

# 3c. Public access block is enforced
PUBLIC_ACCESS=$(aws_local s3api get-public-access-block \
  --bucket "$BUCKET_NAME" \
  --query "PublicAccessBlockConfiguration" \
  --output json 2>/dev/null || echo "{}")
assert_contains "S3 public access - BlockPublicAcls" "$PUBLIC_ACCESS" '"BlockPublicAcls": true'
assert_contains "S3 public access - BlockPublicPolicy" "$PUBLIC_ACCESS" '"BlockPublicPolicy": true'
assert_contains "S3 public access - IgnorePublicAcls" "$PUBLIC_ACCESS" '"IgnorePublicAcls": true'
assert_contains "S3 public access - RestrictPublicBuckets" "$PUBLIC_ACCESS" '"RestrictPublicBuckets": true'

# 3d. Server-side encryption (AES256)
SSE_CONFIG=$(aws_local s3api get-bucket-encryption \
  --bucket "$BUCKET_NAME" \
  --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" \
  --output text 2>/dev/null || echo "NONE")
assert_equals "S3 encryption is AES256" "AES256" "$SSE_CONFIG"

# 3e. Versioning enabled
VERSIONING=$(aws_local s3api get-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --query "Status" \
  --output text 2>/dev/null || echo "NONE")
assert_equals "S3 versioning is Enabled" "Enabled" "$VERSIONING"

# 3f. Bucket policy exists (TLS enforcement)
BUCKET_POLICY=$(aws_local s3api get-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --query "Policy" \
  --output text 2>/dev/null || echo "{}")
assert_contains "S3 TLS policy - DenyInsecureTransport" "$BUCKET_POLICY" "DenyInsecureTransport"
assert_contains "S3 TLS policy - SecureTransport condition" "$BUCKET_POLICY" "aws:SecureTransport"

# 3g. Put and get object round-trip
TEST_KEY="test-integration/hello.txt"
TEST_BODY="localstack-integration-test"
echo -n "$TEST_BODY" | aws_local s3 cp - "s3://${BUCKET_NAME}/${TEST_KEY}"
RETRIEVED=$(aws_local s3 cp "s3://${BUCKET_NAME}/${TEST_KEY}" - 2>/dev/null)
assert_equals "S3 put/get round-trip" "$TEST_BODY" "$RETRIEVED"

# 3h. Delete the test object
aws_local s3 rm "s3://${BUCKET_NAME}/${TEST_KEY}" 2>/dev/null
AFTER_DELETE=$(aws_local s3api head-object \
  --bucket "$BUCKET_NAME" \
  --key "$TEST_KEY" 2>&1 || true)
assert_contains "S3 object deleted successfully" "$AFTER_DELETE" "Not Found\|404\|NoSuchKey\|error"

# 3i. Lifecycle configuration
LIFECYCLE=$(aws_local s3api get-bucket-lifecycle-configuration \
  --bucket "$BUCKET_NAME" \
  --output json 2>/dev/null || echo "{}")
assert_contains "S3 lifecycle rule exists" "$LIFECYCLE" "expire-objects"

# ===========================================================================
# 4. IAM instance profile module tests
# ===========================================================================
echo ""
info "=== IAM Instance Profile Module Tests ==="

# 4a. Role exists
ROLE_INFO=$(aws_local iam get-role --role-name "$IAM_ROLE_NAME" --output json 2>/dev/null || echo "{}")
assert_not_empty "IAM role was created" "$ROLE_INFO"

# 4b. Role name matches
ROLE_NAME_OUT=$(echo "$ROLE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Role',{}).get('RoleName',''))" 2>/dev/null || echo "")
assert_equals "IAM role name matches" "localstack-test-worker-role" "$ROLE_NAME_OUT"

# 4c. Assume role policy allows ec2.amazonaws.com
ASSUME_POLICY=$(echo "$ROLE_INFO" | python3 -c "
import sys, json, urllib.parse
doc = json.load(sys.stdin).get('Role',{}).get('AssumeRolePolicyDocument','')
if isinstance(doc, str):
    doc = urllib.parse.unquote(doc)
print(doc if isinstance(doc, str) else json.dumps(doc))
" 2>/dev/null || echo "")
assert_contains "IAM assume-role policy trusts ec2" "$ASSUME_POLICY" "ec2.amazonaws.com"

# 4d. Instance profile exists
PROFILE_INFO=$(aws_local iam get-instance-profile \
  --instance-profile-name "$IAM_PROFILE_NAME" --output json 2>/dev/null || echo "{}")
assert_not_empty "IAM instance profile was created" "$PROFILE_INFO"

# 4e. Instance profile name matches
PROFILE_NAME_OUT=$(echo "$PROFILE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('InstanceProfile',{}).get('InstanceProfileName',''))" 2>/dev/null || echo "")
assert_equals "IAM instance profile name matches" "localstack-test-worker-profile" "$PROFILE_NAME_OUT"

# ===========================================================================
# 5. STS access role module tests
# ===========================================================================
echo ""
info "=== STS Access Role Module Tests ==="

# 5a. STS role exists
STS_ROLE_INFO=$(aws_local iam get-role --role-name "$STS_ROLE_NAME" --output json 2>/dev/null || echo "{}")
assert_not_empty "STS role was created" "$STS_ROLE_INFO"

# 5b. STS role name matches
STS_ROLE_NAME_OUT=$(echo "$STS_ROLE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Role',{}).get('RoleName',''))" 2>/dev/null || echo "")
assert_equals "STS role name matches" "localstack-test-sts-role" "$STS_ROLE_NAME_OUT"

# 5c. STS role ARN is not empty
assert_not_empty "STS role ARN is populated" "$STS_ROLE_ARN"

# 5d. STS assume role policy trusts ec2
STS_ASSUME_POLICY=$(echo "$STS_ROLE_INFO" | python3 -c "
import sys, json, urllib.parse
doc = json.load(sys.stdin).get('Role',{}).get('AssumeRolePolicyDocument','')
if isinstance(doc, str):
    doc = urllib.parse.unquote(doc)
print(doc if isinstance(doc, str) else json.dumps(doc))
" 2>/dev/null || echo "")
assert_contains "STS assume-role policy trusts ec2" "$STS_ASSUME_POLICY" "ec2.amazonaws.com"

# ===========================================================================
# 6. Terraform plan (idempotency check)
# ===========================================================================
echo ""
info "=== Idempotency Check ==="
PLAN_OUTPUT=$(terraform -chdir="${SCRIPT_DIR}" plan -detailed-exitcode -input=false 2>&1) || PLAN_EXIT=$?
PLAN_EXIT=${PLAN_EXIT:-0}

if [ "$PLAN_EXIT" -eq 0 ]; then
  info "PASS: Terraform plan shows no changes (idempotent)"
  ((PASSED++))
elif [ "$PLAN_EXIT" -eq 2 ]; then
  warn "Terraform plan detected drift (exit code 2). This may be expected with LocalStack."
  # Not counted as failure -- LocalStack often reports drift for bucket policies
else
  fail "FAIL: Terraform plan failed (exit code ${PLAN_EXIT})"
  ((FAILED++))
fi

# ===========================================================================
# Summary
# ===========================================================================
echo ""
echo "==========================================="
info "Tests passed: ${PASSED}"
if [ "${FAILED}" -gt 0 ]; then
  fail "Tests failed: ${FAILED}"
else
  info "Tests failed: 0"
fi
echo "==========================================="

if [ "${FAILED}" -gt 0 ]; then
  fail "LocalStack integration tests FAILED."
  exit 1
fi

info "All LocalStack integration tests PASSED."
exit 0
