terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Remote state in S3 with native lockfile (no DynamoDB table needed since TF 1.10).
  # Values live in backend.hcl (not committed); see backend.hcl.example and docs/DEPLOYMENT.md.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "hookrelay", Environment = var.environment, ManagedBy = "terraform" }
  }
}
