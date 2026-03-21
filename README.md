<div align="center">

# BillForge

### Intelligent Invoice Ingestion & Review Platform

A multi-tenant invoice processing system with pluggable OCR, ML-powered field verification, confidence scoring, and accounting system export -- built for scheduled cloud workers and interactive review dashboards.

<br />

[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB.svg?logo=python&logoColor=white)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248.svg?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Terraform](https://img.shields.io/badge/Terraform-1.6+-7B42BC.svg?logo=terraform&logoColor=white)](https://www.terraform.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com)

<br />

[Documentation](docs/) | [Architecture (RFC)](docs/RFC.md) | [AWS Deployment](docs/AWS_DEPLOYMENT_GUIDE.md) | [Local OCR Setup](docs/LOCAL_DEEPSEEK_OCR_SETUP.md) | [Troubleshooting](docs/TROUBLESHOOTING.md)

</div>

<br />

---

<br />

## Overview

BillForge ingests invoices from email or folder sources, extracts structured data through a staged ML pipeline, scores confidence, and exports approved invoices to accounting systems. Built as a **multi-tenant SaaS platform** with pluggable provider boundaries for OCR, field verification, and export.

### System Architecture

<img src="docs/images/system-architecture.svg" alt="System Architecture" width="100%" />

### Invoice Processing Pipeline

<img src="docs/images/invoice-pipeline.svg" alt="Invoice Processing Pipeline" width="100%" />

<br />

## Core Features

| Domain | Capabilities |
|--------|-------------|
| **Ingestion** | Email (IMAP/OAuth2) and folder sources, per-tenant checkpointing, crash-safe resume, duplicate filtering |
| **OCR** | Pluggable providers (DeepSeek MLX, Apple Vision, hybrid, HTTP proxy), block-level bounding boxes, page image extraction |
| **Extraction** | Staged pipeline: vendor fingerprint, template matching, OCR confidence gate, layout graph, deterministic validation, SLM verification, LLM-assisted vision re-extraction for low-confidence results |
| **Invoice Classification** | SLM classifies invoice type during verification (10 categories: standard, GST, VAT, receipt, utility, professional, PO, credit note, proforma, other) |
| **Extraction Learning** | Tenant-scoped correction feedback loop: records field corrections keyed by invoice type and vendor, feeds prior learnings to SLM on future extractions, auto-prunes after 90 days |
| **Confidence** | Multi-signal scoring (OCR, parser, field verification), risk flagging, configurable tone bands and auto-select thresholds, confidence boost after successful LLM vision re-extraction |
| **Review Dashboard** | Inline row actions (approve, ingest, reingest, delete), humanized status filter tabs, server-side pagination, user-level filtering, reingesting visual state, confidence badges, value-source highlighting, bbox overlay inspect, batch approval, toast notifications |
| **Export** | Tally XML purchase voucher generation with GST ledger entries (CGST/SGST/IGST/Cess), downloadable file or direct POST, S3 artifact storage |
| **Approval Workflows** | Configurable per-tenant: toggle ON/OFF, simple mode (checkboxes for manager review + final sign-off), advanced mode (multi-step builder with role/user approvers, any-one/all-must rules, amount conditions), step-by-step progression, rejection with reason, audit trail per step |
| **Multi-Tenancy** | Tenant onboarding, RBAC (admin/member/viewer), invite flow, tenant-scoped data isolation, per-tenant Gmail integration |
| **Platform Admin** | Tenant usage aggregates, admin onboarding, cross-tenant analytics dashboard, documents-by-tenant charts |
| **Amount Model** | Currency-aware integer minor units (USD 1200.50 = 120050), zero floating-point drift |
| **Auth** | JWT sessions (HS256), Keycloak OIDC (always-on), ROPC login, refresh token encryption, platform admin allowlist, VIEWER read-only role with configurable data scope |
| **India / GST** | Country-aware tenant config (IN default), GSTIN tracking, CGST/SGST/IGST/Cess ledger mapping in Tally exports |

<br />

## Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Backend + frontend runtime |
| Yarn | 4+ | Package manager (Berry, node-modules linker) |
| Docker & Docker Compose | Latest | Infrastructure services |
| Python 3.11+ | 3.11 | OCR + SLM services (Apple Silicon for local MLX) |

### 1. Install Dependencies

```bash
yarn install
```

### 2. Create Python Environment (for local ML services)

```bash
python3 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r invoice-ocr/requirements.local.txt \
                           -r invoice-slm/requirements.local.txt
```

### 3. Start Full Local Stack

```bash
yarn docker:up
```

This starts all services with demo tenants, seeded users, and sample invoices:

| Service | URL |
|---------|-----|
| Backend API | `http://localhost:4100` |
| Frontend Dashboard | `http://localhost:5177` |
| MongoDB | `localhost:27018` |
| Mongo Express | `http://localhost:8181` |
| Mailpit (SMTP/UI) | `localhost:1125` / `http://localhost:8125` |
| MailHog OAuth Wrapper | `http://localhost:8126` |
| MinIO (S3) | `http://localhost:9100` / Console: `http://localhost:9101` |
| MinIO Init | _(runs once to create `billforge-local` bucket)_ |
| OCR Service | `http://localhost:8200` |
| SLM Service | `http://localhost:8300` |
| Keycloak (OIDC) | `http://localhost:8280` |

### 4. Demo Credentials

All demo users log in with password `DemoPass!1`:

| User | Role | Tenant |
|------|------|--------|
| `platform-admin@local.test` | Platform admin | — |
| `tenant-admin-1@local.test` | Tenant admin | Tenant Alpha |
| `tenant-user-1@local.test` | Member | Tenant Alpha |
| `tenant-admin-2@local.test` | Tenant admin | Tenant Beta |
| `tenant-user-2@local.test` | Member | Tenant Beta |
| `mahir.n@globalhealthx.co` | Tenant admin | Neelam and Associates |

**Service credentials (local dev only)**:

| Service | Username | Password |
|---------|----------|----------|
| Keycloak Admin Console | `admin` | `admin` |
| MinIO (S3) Console | `minioadmin` | `minioadmin` |
| Mongo Express | `admin` | `billforge` |

<br />

## Project Structure

```
BillForge/
+-- backend/                    # Node.js API + worker + ingestion pipeline
|   +-- src/
|   |   +-- auth/               # JWT sessions, RBAC middleware, OAuth2
|   |   +-- core/               # Dependency wiring, env config, manifest
|   |   +-- models/             # Mongoose schemas (invoice, checkpoint, tenant, extraction learning)
|   |   +-- ocr/                # DeepSeek OCR provider boundary
|   |   +-- parser/             # Invoice field extraction + date/amount parsing
|   |   +-- providers/          # Email sender, file store, STS adapters
|   |   +-- routes/             # Express route handlers
|   |   +-- services/           # Extraction pipeline, confidence, learning store, Tally export
|   |   +-- sources/            # Email + folder ingestion sources
|   |   +-- verifier/           # SLM field verifier boundary
|   |   +-- utils/              # Logger, crypto, currency, mime helpers
|   |   +-- scripts/            # runWorkerOnce entry point
|   |   +-- e2e/                # Backend integration tests
+-- frontend/                   # React review dashboard (Vite 6)
|   +-- src/
|   |   +-- components/         # InvoiceList, InvoiceDetails, SourceViewer, ...
|   |   +-- e2e/                # Playwright browser tests
+-- invoice-ocr/                # Python FastAPI OCR service
|   +-- app/
|   |   +-- boundary/           # OCRProvider interface
|   |   +-- providers/          # local_mlx, local_apple_vision, local_hybrid, prod_http
+-- invoice-slm/                # Python FastAPI field verifier service
|   +-- app/
|   |   +-- boundary/           # LLMProvider interface
|   |   +-- providers/          # local_mlx, prod_http
+-- infra/
|   +-- modules/                # Reusable Terraform modules
|   |   +-- aws_documentdb_cluster/
|   |   +-- aws_iam_instance_profile/
|   |   +-- aws_s3_bucket/
|   |   +-- aws_scheduled_ec2_service/
|   |   +-- aws_sts_access_role/
|   |   +-- aws_keycloak/
|   +-- terraform/              # Stack composition (main.tf, variables, environments/)
+-- scripts/                    # deploy-aws.sh, docker-up.sh, e2e runners
+-- sample-invoices/            # Local test invoice fixtures
+-- docs/                       # PRD, RFC, deployment guides
+-- .github/workflows/          # CI, security scan, deploy, infra validation
```

<br />

## Approval Workflow System

BillForge supports optional multi-step approval workflows configured per tenant. When disabled, the existing single-step approval flow (any Member or Admin approves directly) is preserved with zero behavioral change.

### Configuration

Tenant admins configure workflows in the **Config** tab:

| Mode | Description |
|------|-------------|
| **OFF** | Any authorized user approves directly (default, backward compatible) |
| **Simple** | Toggle checkboxes: "Require manager review", "Require final sign-off" |
| **Advanced** | Visual step builder with role/user approvers, any/all rules, amount conditions |

### Invoice Lifecycle with Workflow

```
PARSED / NEEDS_REVIEW
       │
       ▼ (workflow ON)
AWAITING_APPROVAL ──→ Step 1 ──→ Step 2 ──→ ... ──→ APPROVED ──→ EXPORTED
       │                                      │
       │ (condition not met)                  │ (rejected)
       └──→ skip step ──→ next               └──→ NEEDS_REVIEW (can re-submit)
```

### Key Behaviors

| Scenario | Behavior |
|----------|----------|
| Workflow OFF | Direct approval, no change from legacy |
| Workflow toggled OFF with in-flight invoices | All AWAITING_APPROVAL revert to NEEDS_REVIEW |
| Invoice edited while in workflow | Workflow resets, returns to NEEDS_REVIEW |
| Rejection | Records reason, returns to NEEDS_REVIEW with full audit trail |
| ALL rule (3 admins) | Requires each to approve individually before advancing |
| Condition: amount > threshold | Step auto-skipped if condition not met |

### Data Model

Workflow config is stored per-tenant in `approvalWorkflows` collection. Invoice progress is tracked in the `workflowState` embedded field on the invoice document, with a `stepResults` array recording every approve/reject/skip action with user, timestamp, and reason.

<br />

## Architecture

### Interactive Diagram

The full architecture diagram is available as a draw.io file:

**[`docs/architecture.drawio`](docs/architecture.drawio)** — open in [draw.io](https://app.diagrams.net) or VS Code with the Draw.io Integration extension.

The diagram covers:
- Ingestion sources (Gmail, Folder, S3 Upload)
- Extraction pipeline (OCR → Parser → SLM → Confidence)
- Approval engine (workflow config, step engine, audit trail)
- Export layer (Tally XML, file store, batch history)
- API layer (all route groups with middleware)
- Frontend components (invoice table, viewer, workflow config, timeline)
- Data layer (MongoDB, S3/MinIO, Keycloak)
- Invoice lifecycle state machine (PENDING → PARSED → AWAITING_APPROVAL → APPROVED → EXPORTED)

<br />

<details>
<summary><strong>Extraction Pipeline</strong> -- Staged ML processing with confidence gates</summary>

<br />

The extraction pipeline processes each invoice through a series of stages, each progressively more expensive:

| Stage | Purpose | Cost |
|-------|---------|:----:|
| **Vendor Fingerprint** | Match known vendor patterns to bypass full OCR | Free |
| **Template Path** | Apply vendor-specific extraction templates | Free |
| **OCR Confidence Gate** | Skip expensive processing if OCR confidence is high | Low |
| **Layout Graph** | Spatial analysis of OCR blocks for field extraction | Medium |
| **Deterministic Validation** | Rule-based field validation and correction | Low |
| **SLM Verifier (relaxed)** | ML-powered field verification with invoice type classification | High |
| **LLM Assist (strict)** | Vision-based re-extraction with page images when confidence < 85% | Higher |
| **Extraction Learning** | Record corrections and feed prior learnings to future SLM calls | Free |

</details>

<details>
<summary><strong>Provider Boundaries</strong> -- Pluggable adapters with zero MLX leakage</summary>

<br />

Python ML services use strict boundary interfaces with explicit provider factory selection:

| Service | Providers | Docker-Safe |
|---------|-----------|:-----------:|
| **OCR** | `local_hybrid`, `local_mlx`, `local_apple_vision`, `prod_http` | `prod_http` only |
| **SLM** | `local_mlx`, `prod_http` | `prod_http` only |

MLX imports exist only in `local_*.py` modules. Docker images install `requirements.prod.txt` (no MLX). Dockerfiles default to `*_ENGINE=prod_http`. Provider selection is explicit with no fallback.

</details>

<details>
<summary><strong>Multi-Tenant Data Model</strong> -- Tenant-isolated partitioning</summary>

<br />

| Collection | Partition Key | Unique Constraint |
|------------|:------------:|-------------------|
| `invoices` | `tenantId` | `(tenantId, sourceType, sourceKey, sourceDocumentId, attachmentName)` |
| `checkpoints` | `tenantId` | `(tenantId, sourceKey)` |
| `users` | -- | `(email)`, `(externalSubject)` |
| `tenantUserRole` | `tenantId` | `(tenantId, userId)` |
| `vendorTemplate` | `tenantId` | `(tenantId, fingerprintHash)` |
| `extractionLearnings` | `tenantId` | `(tenantId, groupKey, groupType)` |
| `tenantIntegration` | `tenantId` | `(tenantId, provider)` |
| `approvalWorkflows` | `tenantId` | `(tenantId)` |

</details>

<details>
<summary><strong>Runtime Composition</strong> -- Environment-specific wiring without code changes</summary>

<br />

An optional manifest file (`APP_MANIFEST_PATH`) composes adapters at runtime:

| Adapter | Options |
|---------|---------|
| **Database** | MongoDB URI |
| **OCR** | `deepseek` / `mock` |
| **Field Verifier** | `http` / `none` |
| **LLM Assist** | Confidence threshold (default 85, 0 = disabled) |
| **Ingestion Sources** | `email` / `folder` |
| **Export** | Tally endpoint/company/ledger |
| **File Store** | Local disk (`ENV=local`) / S3 (`ENV=stg\|prod`) |

Example files: `backend/runtime-manifest.local.json`, `backend/runtime-manifest.prod.example.json`

</details>

<br />

## Tech Stack

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20 | Runtime |
| **TypeScript** | 5.7 | Type-safe backend (strict mode) |
| **Express** | 4.21 | HTTP framework |
| **Mongoose** | 8.9 | MongoDB ODM with schema validation |
| **Zod** | 3.24 | Environment variable validation |
| **Sharp** | 0.34 | Image processing for OCR crops |
| **AWS SDK v3** | 3.x | S3 artifact storage |

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 19 | UI framework |
| **TypeScript** | 5.7 | Type-safe frontend (strict mode) |
| **Vite** | 6 | Build tool and dev server |
| **Axios** | 1.7 | HTTP client |

### ML Services

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.11 | ML service runtime |
| **FastAPI** | 0.115 | OCR + SLM service framework |
| **MLX** | -- | Local Apple Silicon inference (dev only) |
| **DeepSeek OCR** | 4-bit | Document text and layout extraction |
| **Pillow** | 10.4 | Image processing |
| **pypdfium2** | 4.30 | PDF page rendering |

### Infrastructure

| Technology | Purpose |
|-----------|---------|
| **Docker Compose** | Local development environment |
| **MinIO** | S3-compatible local object storage |
| **Keycloak** | OIDC/OAuth2 identity provider |
| **Terraform** | AWS infrastructure as code |
| **AWS ECS Fargate** | Keycloak production deployment |
| **AWS EC2 Spot** | Scheduled worker instances |
| **AWS DocumentDB** | Managed MongoDB-compatible database |
| **AWS S3** | OCR artifact and export storage |
| **AWS IAM/STS** | Authentication and role assumption |
| **GitHub Actions** | CI/CD pipeline (5 workflows, 25 jobs) |

<br />

## Testing

BillForge employs a multi-layer testing strategy with enforced quality gates:

| Layer | Framework | Count | Scope |
|-------|-----------|:-----:|-------|
| **Unit Tests** | Jest + ts-jest | 425 | Parsers, services, providers, utilities (337 backend + 88 frontend) |
| **Backend E2E** | Jest | 4 suites | Folder ingestion, SaaS lifecycle, RBAC, platform admin |
| **Frontend E2E** | Playwright | -- | Ingestion, approval, bbox overlays, crop modals |
| **Dead Code** | Knip | -- | Unused export detection across workspaces |

### Coverage Enforcement

```
Tracked modules: 100% branches, 100% functions, 80%+ lines/statements
Pre-commit hook: Husky runs knip + coverage (blocks commit on failure)
```

### Running Tests

```bash
# All unit tests (backend + frontend)
yarn test

# Backend coverage with threshold enforcement
yarn workspace billforge-backend run coverage

# Dead code analysis
yarn run knip

# Full quality gate (knip + coverage)
yarn run quality:check

# Backend E2E (requires running stack)
yarn e2e:local

# Frontend Playwright E2E (requires running stack)
yarn e2e:frontend:local

# Email OAuth E2E (MailHog + XOAUTH2 + real OCR/SLM)
yarn e2e:email-oauth

# ML endpoint benchmark
yarn benchmark:ml
```

<br />

## Self-Hosting

### Docker Compose (Recommended for Evaluation)

```bash
# Clone the repository
git clone <repo-url>
cd billforge

# Install dependencies
yarn install

# Create Python ML environment (Apple Silicon required for local MLX)
python3 -m venv .venv-ml
./.venv-ml/bin/pip install -r invoice-ocr/requirements.local.txt \
                           -r invoice-slm/requirements.local.txt

# Start everything (MongoDB, backend, frontend, OCR, SLM, demo data)
yarn docker:up
```

### AWS with Terraform

One-command deploy (build + ECR push + Terraform apply):

```bash
ENV=stg AWS_REGION=us-east-1 bash ./scripts/deploy-aws.sh
```

The `infra/terraform/` directory contains production-ready modules:

| Module | Resource |
|--------|----------|
| `aws_scheduled_ec2_service` | Spot worker ASG with cron scale-up/down |
| `aws_documentdb_cluster` | DocumentDB with encryption, audit logging, TLS |
| `aws_s3_bucket` | Artifact storage with TLS enforcement, versioning |
| `aws_iam_instance_profile` | Worker IAM role with scoped S3 access |
| `aws_sts_access_role` | STS roles for auth/backend service integration |
| `aws_keycloak` | ECS Fargate Keycloak with ALB, health checks, PostgreSQL |

```bash
cd infra/terraform
cp environments/prod.tfvars.example terraform.tfvars
# Fill VPC, subnets, image URI, email config, Tally settings
terraform init && terraform plan && terraform apply
```

<br />

## CI/CD

Five GitHub Actions workflows covering the full lifecycle:

| Workflow | Trigger | Jobs |
|----------|---------|:----:|
| **CI** | Push/PR to main/develop | 9 |
| **Security Scan** | Weekly + push to main | 4 |
| **Deploy Staging** | Push to main | 4 |
| **Deploy Production** | Manual dispatch with confirmation | 5 |
| **Infra Validation** | PR/push touching `infra/` | 3 |

### CI Pipeline

```
backend-typecheck ──> backend-test (coverage) ──┐
backend-knip (dead code)                        ├──> docker-build (4x matrix + Trivy scan)
frontend-typecheck ──> frontend-build           │
                   ──> frontend-test ───────────┘
python-ocr-check
python-slm-check
```

### Infrastructure Hardening

- Dockerfiles run as non-root users with health checks
- IMDSv2 enforced on EC2 instances
- S3 buckets enforce TLS-only access
- DocumentDB audit logging and TLS enabled
- CloudWatch log exports for profiler and audit
- Trivy container scanning on every CI build
- Gitleaks secret detection on push to main

<br />

## Architecture Principles

**Pluggable Provider Boundaries** -- OCR, SLM, file storage, email transport, and STS are all defined as interfaces with explicit factory selection. Swapping providers is a configuration change.

**Integer Minor Units** -- All currency amounts are stored as integers in the smallest unit (cents, yen). Decimal formatting happens only at display and export boundaries, eliminating floating-point drift.

**Crash-Safe Checkpointing** -- Ingestion checkpoints are persisted per-file. If a worker crashes mid-batch, the next run resumes from the last saved marker. MongoDB unique indexes prevent duplicate processing.

**MLX Isolation** -- Local ML inference (Apple Silicon only) is strictly isolated in `local_*.py` provider modules. Production Docker images contain zero MLX dependencies. Provider selection is explicit with no fallback chain.

**Tenant-First Data Model** -- Every data-bearing collection includes `tenantId` as a partition key. Queries are scoped by the authenticated tenant context. Platform admin APIs return only aggregates, never invoice-level data.

**Runtime Composition** -- Environment-specific wiring (`local`/`stg`/`prod`) is handled through manifest files and env variables, not code branches. The same image serves all environments.

<br />

## Contributing

1. **Read the RFC** in `docs/RFC.md` to understand architecture decisions.
2. **Follow provider boundaries** -- ML imports must stay in `local_*.py` modules.
3. **Add tests** -- unit tests for services, E2E for workflows. Coverage thresholds are enforced.
4. **Run quality gate** before committing: `yarn run quality:check`.
5. **Use integer minor units** for all amount storage and transmission.

```bash
# Install and verify
yarn install
yarn run quality:check

# Run full local stack
yarn docker:up

# Teardown
yarn docker:down
```

<br />

## Additional Documentation

- [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md) -- Step-by-step Terraform deployment
- [Local OCR Setup](docs/LOCAL_DEEPSEEK_OCR_SETUP.md) -- MLX model installation for Apple Silicon
- [Troubleshooting](docs/TROUBLESHOOTING.md) -- Docker status, health checks, common issues
- [Product Requirements](docs/PRD.md) -- Feature specifications
- [Architecture & Design Decisions](docs/RFC.md) -- RFC-style rationale for key choices

<br />

## License

This project is licensed under the [MIT License](LICENSE).

<br />

---

<div align="center">

Built with Node.js, React, FastAPI, and Terraform.

[Documentation](docs/) | [Report an Issue](../../issues)

</div>
