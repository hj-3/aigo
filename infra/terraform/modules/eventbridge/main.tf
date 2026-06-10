locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "eventbridge"
  })
}

resource "aws_cloudwatch_event_bus" "main" {
  name = "${local.p}-bus"
  tags = local.common_tags
}

resource "aws_cloudwatch_event_archive" "main" {
  name             = "${local.p}-archive"
  event_source_arn = aws_cloudwatch_event_bus.main.arn
  retention_days   = 90
}

# ──────────────────────────────────────────────────────────────────────────────
# Schema Registry
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_schemas_registry" "main" {
  name        = "${local.p}-registry"
  description = "Event schemas for AgentOps Platform"
  tags        = local.common_tags
}
