# Reusable Terraform Modules

This folder is the copyable module catalog for product teams.

## Copy Model

- Keep generic modules in `infra/modules`.
- Each product stack (for now `infra/terraform`) references them via local paths:
  - `../modules/aws_iam_instance_profile`
  - `../modules/aws_scheduled_ec2_service`
  - `../modules/aws_documentdb_cluster`
- New products can copy the entire `infra/modules` directory without changing module interfaces.

## Registry Migration (Mechanical)

When moving to a Terraform registry, keep variable/output contracts stable and change only `source` addresses in stack `main.tf`.

Example:

```hcl
# Before
source = "../modules/aws_scheduled_ec2_service"

# After
source = "app/platform/aws//scheduled_ec2_service"
```

No stack-level variable rewrites should be required if contracts stay unchanged.

## Module Boundaries

- `aws_iam_instance_profile`: IAM role + instance profile + managed policy attachments.
- `aws_scheduled_ec2_service`: launch template + scheduled ASG + ingress SG + container bootstrap with `spot` or `on-demand` market mode.
- `aws_documentdb_cluster`: DocumentDB cluster + instances + subnet group + SG + connection URI output.
