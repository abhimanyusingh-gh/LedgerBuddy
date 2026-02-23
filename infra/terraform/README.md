# Invoice Processor Stack

This folder is the product stack composition layer.

- Reusable module implementations live in `../modules`.
- Stack-specific decisions (resource naming, app env mapping, schedule defaults) stay here.

## Registry Transition

To move modules to a Terraform registry later, edit `source` fields in `main.tf` and keep module input/output contracts unchanged.
