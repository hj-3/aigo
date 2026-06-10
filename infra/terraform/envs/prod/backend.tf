terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

  }

  backend "s3" {
    bucket         = "aigo-tf-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = "prod"
      ManagedBy   = "terraform"
      Repository  = "aigo"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

