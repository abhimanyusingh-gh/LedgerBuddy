locals {
  launch_template_name_prefix = "${var.name}-lt-"
  security_group_name         = "${var.name}-sg"
  autoscaling_group_name      = "${var.name}-asg"
}

resource "aws_security_group" "this" {
  name        = local.security_group_name
  description = "Security group for service ${var.name}"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.from_port
      to_port     = ingress.value.to_port
      protocol    = ingress.value.protocol
      cidr_blocks = ingress.value.cidr_blocks
    }
  }

  tags = merge(var.tags, { Name = local.security_group_name })
}

resource "aws_launch_template" "this" {
  name_prefix   = local.launch_template_name_prefix
  image_id      = var.ami_id
  instance_type = var.instance_type
  key_name      = var.key_name != "" ? var.key_name : null

  iam_instance_profile {
    name = var.instance_profile_name
  }

  vpc_security_group_ids = [aws_security_group.this.id]

  dynamic "instance_market_options" {
    for_each = var.market_type == "spot" ? [1] : []
    content {
      market_type = "spot"

      spot_options {
        instance_interruption_behavior = var.spot_interruption_behavior
        spot_instance_type             = var.spot_instance_type
      }
    }
  }

  user_data = base64encode(
    templatefile("${path.module}/user_data.sh.tmpl", {
      container_image   = var.container_image
      container_env     = var.container_env
      container_command = var.container_command
    })
  )

  tag_specifications {
    resource_type = "instance"

    tags = merge(var.tags, { Name = var.name })
  }

  tags = var.tags
}

resource "aws_autoscaling_group" "this" {
  name                = local.autoscaling_group_name
  max_size            = var.max_size
  min_size            = var.min_size
  desired_capacity    = var.desired_capacity
  vpc_zone_identifier = var.subnet_ids

  launch_template {
    id      = aws_launch_template.this.id
    version = "$Latest"
  }

  health_check_type = "EC2"

  tag {
    key                 = "Name"
    value               = var.name
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_autoscaling_schedule" "scale_up" {
  scheduled_action_name  = "${var.name}-scale-up"
  autoscaling_group_name = aws_autoscaling_group.this.name
  recurrence             = var.scale_up_cron
  min_size               = var.scale_up_min_size
  max_size               = var.scale_up_max_size
  desired_capacity       = var.scale_up_desired_capacity
}

resource "aws_autoscaling_schedule" "scale_down" {
  scheduled_action_name  = "${var.name}-scale-down"
  autoscaling_group_name = aws_autoscaling_group.this.name
  recurrence             = var.scale_down_cron
  min_size               = var.scale_down_min_size
  max_size               = var.scale_down_max_size
  desired_capacity       = var.scale_down_desired_capacity
}
