locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "cognito"
  })
}

resource "aws_cognito_user_pool" "main" {
  name = "${local.p}-user-pool"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "[AgentOps] 계정이 생성되었습니다"
      email_message = "{username}님의 임시 비밀번호: {####}"
      sms_message   = "{username}님의 임시 비밀번호: {####}"
    }
  }

  schema {
    name                     = "orgId"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                     = "role"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false
    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "dashboard" {
  name         = "${local.p}-dashboard-client"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  callback_urls = var.allowed_callback_urls
  logout_urls   = var.allowed_logout_urls

  supported_identity_providers = ["COGNITO"]

  access_token_validity  = 60 # minutes
  id_token_validity      = 60
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

# ──────────────────────────────────────────────────────────────────────────────
# User Groups (RBAC)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cognito_user_group" "owner" {
  name         = "OWNER"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Organization owner — full access"
  precedence   = 1
}

resource "aws_cognito_user_group" "admin" {
  name         = "ADMIN"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Admin — analysis, approvals, settings"
  precedence   = 2
}

resource "aws_cognito_user_group" "reviewer" {
  name         = "REVIEWER"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Reviewer — view reports, approve/reject"
  precedence   = 3
}

resource "aws_cognito_user_group" "viewer" {
  name         = "VIEWER"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Viewer — read-only access"
  precedence   = 4
}
