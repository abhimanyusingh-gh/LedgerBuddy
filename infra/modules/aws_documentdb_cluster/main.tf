locals {
  cluster_identifier = var.name
}

resource "aws_security_group" "this" {
  name        = "${var.name}-sg"
  description = "Security group for DocumentDB cluster ${var.name}"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = toset(var.allowed_cidr_blocks)
    content {
      from_port   = 27017
      to_port     = 27017
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_docdb_subnet_group" "this" {
  name        = "${var.name}-subnets"
  description = "Subnet group for DocumentDB ${var.name}"
  subnet_ids  = var.subnet_ids

  tags = var.tags
}

resource "aws_docdb_cluster_parameter_group" "this" {
  family      = "docdb5.0"
  name        = "${var.name}-params"
  description = "Parameter group for ${var.name} with audit logging"

  parameter {
    name  = "audit_logs"
    value = "enabled"
  }

  parameter {
    name  = "tls"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_docdb_cluster" "this" {
  cluster_identifier              = local.cluster_identifier
  engine                          = "docdb"
  engine_version                  = var.engine_version
  master_username                 = var.master_username
  master_password                 = var.master_password
  db_subnet_group_name            = aws_docdb_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.this.id]
  db_cluster_parameter_group_name = aws_docdb_cluster_parameter_group.this.name
  backup_retention_period         = var.backup_retention_period
  preferred_backup_window         = var.preferred_backup_window
  storage_encrypted               = var.storage_encrypted
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = var.skip_final_snapshot
  apply_immediately               = var.apply_immediately
  enabled_cloudwatch_logs_exports = ["audit", "profiler"]

  tags = var.tags
}

resource "aws_docdb_cluster_instance" "this" {
  count = var.instance_count

  identifier         = "${var.name}-${count.index + 1}"
  cluster_identifier = aws_docdb_cluster.this.id
  instance_class     = var.instance_class
  apply_immediately  = var.apply_immediately

  tags = var.tags
}
