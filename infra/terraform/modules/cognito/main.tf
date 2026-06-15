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

  # Self-signup enabled — external users can register directly
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # SES for production email — no 50/day Cognito default limit, custom from address
  email_configuration {
    email_sending_account  = "DEVELOPER"
    source_arn             = var.ses_email_identity_arn
    from_email_address     = var.ses_from_address
    reply_to_email_address = var.ses_from_address
  }

  verification_message_template {
    default_email_option  = "CONFIRM_WITH_CODE"
    email_subject_by_link = "[AIGO] 이메일 주소를 확인해주세요"
    email_message_by_link = <<-HTML
      <html><body>
      <h2>AIGO 회원가입을 완료해주세요</h2>
      <p>아래 링크를 클릭하여 이메일 주소를 인증하세요.</p>
      <p><a href="{##Click Here##}" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">이메일 인증하기</a></p>
      <p>링크는 24시간 동안 유효합니다.</p>
      <p style="color:#6b7280;font-size:12px;">AIGO — AI-Powered PR Analysis Platform</p>
      </body></html>
    HTML
    email_subject         = "[AIGO] 이메일 인증 코드: {####}"
    email_message         = "<html><body><h2>AIGO 회원가입</h2><p>인증 코드: <strong>{####}</strong></p><p>5분 이내에 입력해주세요.</p></body></html>"
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

  schema {
    name                     = "onboardingCompleted"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false
    string_attribute_constraints {
      min_length = 1
      max_length = 5
    }
  }

  lambda_config {
    post_confirmation = var.post_confirmation_lambda_arn
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 2
}

resource "aws_cognito_managed_login_branding" "main" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.dashboard.id
  use_cognito_provided_values = true
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
