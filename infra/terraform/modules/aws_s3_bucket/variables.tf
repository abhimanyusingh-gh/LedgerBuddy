variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name."
}

variable "force_destroy" {
  type        = bool
  description = "Allow destroying bucket even when objects exist."
  default     = false
}

variable "versioning_enabled" {
  type        = bool
  description = "Enable object versioning."
  default     = true
}

variable "expiration_days" {
  type        = number
  description = "Optional lifecycle expiration in days. Set 0 to disable expiration."
  default     = 0
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources."
  default     = {}
}
