terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Shared remote state bucket/lock table — the same one the Voice Agent
  # product's Terraform uses, distinct key per product so state never
  # collides. Values are supplied via -backend-config at `terraform init`
  # time (kept out of source control since they're environment-specific).
  backend "s3" {
    key = "chat-agent/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Product   = "chat-agent"
      Platform  = "agents-platform"
      ManagedBy = "terraform"
    }
  }
}
