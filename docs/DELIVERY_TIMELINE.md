# Delivery Timeline (7-Day View)

This timeline is a transparent planning and review artifact.  
Git commit timestamps are preserved as-is and are not rewritten.

## Date Range

- Start: 2026-02-19
- End: 2026-02-25

## Day-by-Day Breakdown

### 2026-02-19 (Day 1)

- Finalize product scope and technical direction:
  - `docs/PRD.md`
  - `docs/RFC.md`
- Bootstrap backend pipeline:
  - ingestion interfaces/sources
  - OCR providers
  - extraction + confidence
  - checkpointing + export services
- Add backend test foundation and branch coverage targets.

### 2026-02-20 (Day 2)

- Finish React dashboard baseline:
  - invoice list/details
  - confidence display
  - approval/export controls
- Add pagination-safe invoice loading and selection helpers.

### 2026-02-21 (Day 3)

- Add ingestion job progress UX:
  - running/completed/failed state
  - processed count
  - success/duplicate/failure counters
- Stabilize status polling behavior and disable repeated ingestion clicks while running.

### 2026-02-22 (Day 4)

- Harden data correctness:
  - minor-unit amount handling end-to-end
  - pre-export validation and approval gating
  - editable parsed fields prior to export
- Extend regression tests around lifecycle status transitions.

### 2026-02-23 (Day 5)

- Infrastructure module work:
  - Terraform `spot_worker` module
  - Terraform `documentdb` module
  - production-oriented outputs and tfvars usage
- Add deploy runbook for junior developers:
  - `docs/AWS_DEPLOYMENT_GUIDE.md`

### 2026-02-24 (Day 6)

- Local reliability and repeatability:
  - Compose-first developer flow
  - e2e script and Docker-backed run path
  - sample ingestion datasets and benchmark corpus wiring
- Validate end-to-end folder ingestion and crash-resume behavior.

### 2026-02-25 (Day 7)

- Cleanup and hardening pass:
  - dead code checks (Knip)
  - quality gate enforcement
  - docs polish (`README`, sample corpus docs)
- Final verification:
  - unit tests
  - branch coverage checks
  - local e2e execution.

## Milestone Mapping

- M1 Scope + Architecture: `ad662e8`
- M2 Backend Engine: `7d735fb`
- M3 Dashboard + Local Runtime: `cecba28`
- M4 Infra Modules: `4a825c7`
- M5 Runbook + Corpus: `f813658`
