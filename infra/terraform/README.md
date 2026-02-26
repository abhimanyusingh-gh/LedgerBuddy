# Invoice Processor Stack

This folder is the product stack composition layer.

- Reusable module implementations live in `../modules`.
- Stack-specific decisions (resource naming, app env mapping, schedule defaults) stay here.
- Production stack now wires:
  - `aws_documentdb_cluster` (optional)
  - `aws_s3_bucket` for OCR artifacts/crops
  - worker IAM policy for S3 artifact read/write
  - backend env mapping (`ENV=prod`, `S3_FILE_STORE_*`)

## Registry Transition

To move modules to a Terraform registry later, edit `source` fields in `main.tf` and keep module input/output contracts unchanged.
