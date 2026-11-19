variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "image_tag" {
  type        = string
  description = "Immutable image tag (git sha) pushed by the deploy workflow."
}

variable "github_repository" {
  type        = string
  default     = "DRTX2/hookrelay"
  description = "owner/repo allowed to assume the deploy roles via GitHub OIDC."
}

variable "create_github_oidc_provider" {
  type        = bool
  default     = true
  description = "Set false if the account already has the token.actions.githubusercontent.com provider."
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate for HTTPS. Empty = HTTP only (demo environments)."
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "api_desired" {
  type    = number
  default = 2
}

variable "worker_desired" {
  type    = number
  default = 2
}

variable "worker_max" {
  type    = number
  default = 10
}

variable "retry_schedule" {
  type    = string
  default = "5,300,1800,7200,18000,36000,36000"
}

variable "alarm_email" {
  type    = string
  default = ""
}

variable "integration_secret_arn" {
  type        = string
  default     = ""
  description = "Optional Atalaya integration: Secrets Manager secret (JSON) with NIMBUS_WEBHOOK_SECRET. Empty = standalone."
}
