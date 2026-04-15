terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  cluster_name = "${var.name}-cluster"
  service_name = "${var.name}-service"
  alb_name     = "${var.name}-alb"
  tg_name      = "${var.name}-tg"

  use_https = var.certificate_arn != ""

  keycloak_environment = concat(
    [
      { name = "KC_BOOTSTRAP_ADMIN_USERNAME", value = "admin" },
      { name = "KC_BOOTSTRAP_ADMIN_PASSWORD", value = var.keycloak_admin_password },
      { name = "KC_DB", value = "postgres" },
      { name = "KC_DB_URL", value = var.keycloak_db_url },
      { name = "KC_DB_USERNAME", value = var.keycloak_db_username },
      { name = "KC_DB_PASSWORD", value = var.keycloak_db_password },
      { name = "KC_HTTP_ENABLED", value = "true" },
      { name = "KC_HEALTH_ENABLED", value = "true" },
      { name = "KC_METRICS_ENABLED", value = "true" },
      { name = "KC_PROXY_HEADERS", value = "xforwarded" },
      { name = "KC_HOSTNAME_STRICT", value = var.keycloak_hostname != "" ? "true" : "false" },
    ],
    var.keycloak_hostname != "" ? [
      { name = "KC_HOSTNAME", value = var.keycloak_hostname },
    ] : [],
  )
}

# ---------------------------------------------------------------------------
# ECS cluster
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = local.cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# IAM: task execution role (pulls images, writes logs)
# ---------------------------------------------------------------------------

data "aws_region" "current" {}

resource "aws_iam_role" "ecs_execution" {
  name = "${var.name}-ecs-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---------------------------------------------------------------------------
# IAM: task role (runtime permissions for the container)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name = "${var.name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

# ---------------------------------------------------------------------------
# CloudWatch log group
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = 30

  tags = var.tags
}

# ---------------------------------------------------------------------------
# ECS task definition
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "keycloak"
      image     = var.keycloak_image
      essential = true
      command   = ["start", "--optimized"]

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = local.keycloak_environment

      healthCheck = {
        command     = ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/${var.container_port} && echo -e 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '200'"]
        interval    = 15
        timeout     = 5
        retries     = 5
        startPeriod = 60
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "keycloak"
        }
      }
    }
  ])

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb-sg"
  description = "Security group for Keycloak ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  dynamic "ingress" {
    for_each = local.use_https ? [1] : []
    content {
      description = "HTTPS"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = var.allowed_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-alb-sg" })
}

resource "aws_security_group" "keycloak_task" {
  name        = "${var.name}-task-sg"
  description = "Security group for Keycloak ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Traffic from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-task-sg" })
}

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------

resource "aws_lb" "this" {
  name               = local.alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  tags = var.tags
}

resource "aws_lb_target_group" "this" {
  name        = local.tg_name
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = local.use_https ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = local.use_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    target_group_arn = local.use_https ? null : aws_lb_target_group.this.arn
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  count = local.use_https ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# ECS service
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name            = local.service_name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.keycloak_task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "keycloak"
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [
    aws_lb_listener.http,
    aws_lb_listener.https,
  ]

  tags = var.tags
}
