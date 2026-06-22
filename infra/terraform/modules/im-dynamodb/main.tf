locals {
  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Module    = "im-dynamodb"
    Product   = "IncidentManagement"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# 1. aigo-im-Incidents
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "incidents" {
  name         = "aigo-im-Incidents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-status-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "GSI2-account-detectedAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-Incidents" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 2. aigo-im-InvestigationResults
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "investigation_results" {
  name         = "aigo-im-InvestigationResults"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-InvestigationResults" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 3. aigo-im-Reports
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "reports" {
  name         = "aigo-im-Reports"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-generatedAt-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-Reports" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 4. aigo-im-RecoveryActions
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "recovery_actions" {
  name         = "aigo-im-RecoveryActions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-incident-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-RecoveryActions" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 5. aigo-im-InvestigationTargets
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "investigation_targets" {
  name         = "aigo-im-InvestigationTargets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-account-alarmName-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-InvestigationTargets" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 6. aigo-im-ExternalIntegrations
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "external_integrations" {
  name         = "aigo-im-ExternalIntegrations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-integrationId-index"
    hash_key        = "GSI1PK"
    projection_type = "KEYS_ONLY"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-ExternalIntegrations" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 7. aigo-im-LinkedAccounts
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "linked_accounts" {
  name         = "aigo-im-LinkedAccounts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-LinkedAccounts" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 8. aigo-im-AllowedActions
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "allowed_actions" {
  name         = "aigo-im-AllowedActions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-AllowedActions" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 9. aigo-im-RemediationSettings
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "remediation_settings" {
  name         = "aigo-im-RemediationSettings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-RemediationSettings" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 10. aigo-im-SecurityEvents
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "security_events" {
  name         = "aigo-im-SecurityEvents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-severity-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-SecurityEvents" })
}

# ──────────────────────────────────────────────────────────────────────────────
# 11. aigo-im-Conversations (TTL 30일)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "conversations" {
  name         = "aigo-im-Conversations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-userId-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
  deletion_protection_enabled = true
  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
  tags = merge(local.common_tags, { Name = "aigo-im-Conversations" })
}
