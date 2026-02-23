variable "name" {
  type        = string
  description = "Service name used in ASG, launch template, and tags."
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where the service security group is created."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets where instances will run."
}

variable "ami_id" {
  type        = string
  description = "AMI used by launch template."
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type."
}

variable "key_name" {
  type        = string
  description = "Optional SSH key pair name."
  default     = ""
}

variable "instance_profile_name" {
  type        = string
  description = "IAM instance profile attached to instances."
}

variable "market_type" {
  type        = string
  description = "EC2 market type: 'spot' or 'on-demand'."
  default     = "spot"

  validation {
    condition     = contains(["spot", "on-demand"], var.market_type)
    error_message = "market_type must be either 'spot' or 'on-demand'."
  }
}

variable "spot_interruption_behavior" {
  type        = string
  description = "Spot interruption behavior when market_type='spot'."
  default     = "terminate"

  validation {
    condition     = contains(["terminate", "stop", "hibernate"], var.spot_interruption_behavior)
    error_message = "spot_interruption_behavior must be one of: terminate, stop, hibernate."
  }
}

variable "spot_instance_type" {
  type        = string
  description = "Spot request type when market_type='spot'."
  default     = "one-time"

  validation {
    condition     = contains(["one-time", "persistent"], var.spot_instance_type)
    error_message = "spot_instance_type must be either 'one-time' or 'persistent'."
  }
}

variable "container_image" {
  type        = string
  description = "Container image to run on each instance."
}

variable "container_command" {
  type        = string
  description = "Optional container command appended to docker run."
  default     = ""
}

variable "container_env" {
  type        = map(string)
  description = "Environment variables injected into the container."
  default     = {}
}

variable "ingress_rules" {
  type = list(object({
    from_port   = number
    to_port     = number
    protocol    = string
    cidr_blocks = list(string)
  }))
  description = "Ingress rules for the service security group."
  default     = []
}

variable "min_size" {
  type        = number
  description = "ASG minimum size."
  default     = 0
}

variable "max_size" {
  type        = number
  description = "ASG maximum size."
  default     = 1
}

variable "desired_capacity" {
  type        = number
  description = "ASG desired capacity outside schedules."
  default     = 0
}

variable "scale_up_cron" {
  type        = string
  description = "Cron schedule used for scale-up action."
}

variable "scale_down_cron" {
  type        = string
  description = "Cron schedule used for scale-down action."
}

variable "scale_up_min_size" {
  type        = number
  description = "Min size during scale-up schedule."
  default     = 1
}

variable "scale_up_max_size" {
  type        = number
  description = "Max size during scale-up schedule."
  default     = 1
}

variable "scale_up_desired_capacity" {
  type        = number
  description = "Desired capacity during scale-up schedule."
  default     = 1
}

variable "scale_down_min_size" {
  type        = number
  description = "Min size during scale-down schedule."
  default     = 0
}

variable "scale_down_max_size" {
  type        = number
  description = "Max size during scale-down schedule."
  default     = 1
}

variable "scale_down_desired_capacity" {
  type        = number
  description = "Desired capacity during scale-down schedule."
  default     = 0
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources."
  default     = {}
}
