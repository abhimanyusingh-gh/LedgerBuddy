variable "name" {
  type        = string
  description = "IAM role name."
}

variable "trusted_services" {
  type        = list(string)
  description = "AWS services that can assume this role."
  default     = []
}

variable "trusted_arns" {
  type        = list(string)
  description = "IAM principals that can assume this role."
  default     = []
}

variable "allowed_assume_role_arns" {
  type        = list(string)
  description = "Role ARNs this role can assume through STS."
  default     = []
}

variable "managed_policy_arns" {
  type        = list(string)
  description = "Managed IAM policy ARNs to attach."
  default     = []
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to IAM resources."
  default     = {}
}
