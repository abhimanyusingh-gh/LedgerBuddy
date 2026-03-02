# Invoice Processor Stack

This folder is the product stack composition layer.

- Reusable module implementations live in `../modules`.
- Stack-specific decisions (resource naming, app env mapping, schedule defaults) stay here.
- Production stack now wires:
  - `aws_documentdb_cluster` (optional)
  - `aws_s3_bucket` for OCR artifacts/crops
  - `aws_sts_access_role` for auth and backend service identities when `environment` is `stg` or `prod`
  - worker IAM policy for S3 artifact read/write
  - backend env mapping (`ENV=prod`, `S3_FILE_STORE_*`)

## Environment Contract

- `environment` must be one of `local | stg | prod`.
- STS IAM roles are provisioned only for `stg` and `prod`.
- `local` skips STS role provisioning to keep local runtime Docker-only.

## Registry Transition

To move modules to a Terraform registry later, edit `source` fields in `main.tf` and keep module input/output contracts unchanged.
