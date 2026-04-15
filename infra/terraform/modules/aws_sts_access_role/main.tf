terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_iam_role" "this" {
  name = var.name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Principal = merge(
          length(var.trusted_services) > 0 ? { Service = var.trusted_services } : {},
          length(var.trusted_arns) > 0 ? { AWS = var.trusted_arns } : {}
        )
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "assume_role" {
  count = length(var.allowed_assume_role_arns) > 0 ? 1 : 0

  name = "${var.name}-assume-role"
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AssumeConfiguredRoles"
        Effect   = "Allow"
        Action   = ["sts:AssumeRole"]
        Resource = var.allowed_assume_role_arns
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "managed" {
  for_each = toset(var.managed_policy_arns)

  role       = aws_iam_role.this.name
  policy_arn = each.value
}
