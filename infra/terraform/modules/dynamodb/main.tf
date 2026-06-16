locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "dynamodb"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Helper: server-side encryption block (used in every table)
# ──────────────────────────────────────────────────────────────────────────────
# All tables use CMK via KMS.

# ══════════════════════════════════════════════════════════════════════════════
# 1. Organizations
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "organizations" {
  name         = "${local.p}-Organizations"
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

  # GSI1: lookup org by GitHub account login (GSI1PK = GITHUB_LOGIN#{githubLogin})
  global_secondary_index {
    name            = "GSI1-orgId-provider-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Organizations" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 2. Users
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "users" {
  name         = "${local.p}-Users"
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
    name            = "GSI1-orgId-email-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Users" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 3. Repositories
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "repositories" {
  name         = "${local.p}-Repositories"
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
  # GSI2: lookup by provider repo ID (GitHub repo ID) for webhook routing
  # PK = PROVIDER_REPO#{providerRepoId}, SK = ORG#{orgId}
  attribute {
    name = "GSI2PK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-provider-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-providerRepoId-index"
    hash_key        = "GSI2PK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Repositories" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 4. Integrations
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "integrations" {
  name         = "${local.p}-Integrations"
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
  # GSI2: lookup by externalId (GitHub installationId, Slack teamId) → orgId
  # PK = INSTALLATION#{installationId} or SLACK_TEAM#{teamId}, SK = type
  attribute {
    name = "GSI2PK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-orgId-type-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-externalId-index"
    hash_key        = "GSI2PK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Integrations" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 14. OrgInvitations  (TTL enabled — 7 days for pending invitations)
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "org_invitations" {
  name         = "${local.p}-OrgInvitations"
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
  # GSI1: lookup by invitee email to find pending invitations
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  global_secondary_index {
    name            = "GSI1-email-createdAt-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-OrgInvitations" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 5. AnalysisJobs
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "analysis_jobs" {
  name         = "${local.p}-AnalysisJobs"
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
    name            = "GSI1-repoId-createdAt-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-orgStatus-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-AnalysisJobs" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 6. AgentRuns
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "agent_runs" {
  name         = "${local.p}-AgentRuns"
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
    name            = "GSI1-jobId-agentType-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-AgentRuns" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 7. Reports
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "reports" {
  name         = "${local.p}-Reports"
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
  attribute {
    name = "GSI3PK"
    type = "S"
  }
  attribute {
    name = "GSI3SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-jobId-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-repoId-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI3-orgApprovalStatus-createdAt-index"
    hash_key        = "GSI3PK"
    range_key       = "GSI3SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Reports" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 8. Findings
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "findings" {
  name         = "${local.p}-Findings"
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
    name            = "GSI1-reportId-severity-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-repoCategory-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Findings" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 9. Approvals
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "approvals" {
  name         = "${local.p}-Approvals"
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
    name            = "GSI1-reportId-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-orgId-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Approvals" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 10. FixRequests
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "fix_requests" {
  name         = "${local.p}-FixRequests"
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
    name            = "GSI1-reportId-status-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-orgStatus-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-FixRequests" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 11. Incidents
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "incidents" {
  name         = "${local.p}-Incidents"
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
    name            = "GSI1-orgId-createdAt-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-serviceStatus-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-Incidents" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 12. AuditLogs  (TTL enabled — 90 days)
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "audit_logs" {
  name         = "${local.p}-AuditLogs"
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

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  global_secondary_index {
    name            = "GSI1-orgId-createdAt-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-actorId-createdAt-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = true

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-AuditLogs" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 13. UsageRecords
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "usage_records" {
  name         = "${local.p}-UsageRecords"
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

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-UsageRecords" })
}

# ══════════════════════════════════════════════════════════════════════════════
# 15. AgentMemory — Long-term memory for agents (PR analyses, incidents, developer patterns)
# ══════════════════════════════════════════════════════════════════════════════
resource "aws_dynamodb_table" "agent_memory" {
  name         = "${local.p}-AgentMemory"
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

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  global_secondary_index {
    name            = "GSI1-repo-time-index"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-author-time-index"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = merge(local.common_tags, { Name = "${local.p}-AgentMemory" })
}
