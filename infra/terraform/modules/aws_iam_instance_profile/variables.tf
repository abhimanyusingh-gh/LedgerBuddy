variable "name" {
  type        = string
  description = "Resource base name used for IAM role and instance profile."
}

variable "policy_arns" {
  type        = list(string)
  description = "Managed IAM policies attached to the role."
  default = [
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  ]
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to IAM resources."
  default     = {}
}
