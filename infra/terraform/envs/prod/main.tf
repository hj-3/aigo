data "aws_caller_identity" "current" {}

locals {
  account_id = var.aws_account_id != "" ? var.aws_account_id : data.aws_caller_identity.current.account_id
  common_tags = {
    Project     = var.project
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# KMS Keys
# ──────────────────────────────────────────────────────────────────────────────
module "kms" {
  source         = "../../modules/kms"
  project        = var.project
  aws_account_id = local.account_id
  aws_region     = var.aws_region
}

# ──────────────────────────────────────────────────────────────────────────────
# VPC
# ──────────────────────────────────────────────────────────────────────────────
module "vpc" {
  source             = "../../modules/vpc"
  project            = var.project
  region             = var.aws_region
  enable_nat_gateway = var.enable_nat_gateway
}

# ──────────────────────────────────────────────────────────────────────────────
# S3 Buckets
# ──────────────────────────────────────────────────────────────────────────────
module "s3" {
  source      = "../../modules/s3"
  project     = var.project
  kms_key_arn = module.kms.s3_key_arn
}

# ──────────────────────────────────────────────────────────────────────────────
# DynamoDB Tables (13)
# ──────────────────────────────────────────────────────────────────────────────
module "dynamodb" {
  source      = "../../modules/dynamodb"
  project     = var.project
  kms_key_arn = module.kms.dynamodb_key_arn
}

# ──────────────────────────────────────────────────────────────────────────────
# Bedrock Knowledge Bases (4 domain-separated)
# ──────────────────────────────────────────────────────────────────────────────
module "bedrock_kb" {
  source         = "../../modules/bedrock-kb"
  project        = var.project
  aws_region     = var.aws_region
  aws_account_id = local.account_id
  kb_bucket_arn  = module.s3.bucket_arns["kb"]
  kb_bucket_name = module.s3.bucket_names["kb"]
}

# ──────────────────────────────────────────────────────────────────────────────
# Bedrock AgentCore — 7 Strands agents + aliases + SSM parameter store
# ──────────────────────────────────────────────────────────────────────────────
module "bedrock_agentcore" {
  source                = "../../modules/bedrock-agentcore"
  project               = var.project
  aws_region            = var.aws_region
  aws_account_id        = local.account_id
  knowledge_base_arns   = [module.bedrock_kb.knowledge_base_arn]
  s3_agent_packages_arn = module.s3.bucket_arns["agent_packages"]
  kms_key_arn           = module.kms.lambda_key_arn

  agent_instructions = {
    orchestrator   = file("${path.root}/../../../../prompts/v1/orchestrator.md")
    code-reviewer  = file("${path.root}/../../../../prompts/v1/code-reviewer.md")
    infra-reviewer = file("${path.root}/../../../../prompts/v1/infra-reviewer.md")
    risk-reviewer  = file("${path.root}/../../../../prompts/v1/risk-reviewer.md")
    security-agent = file("${path.root}/../../../../prompts/v1/security-agent.md")
    incident-agent = file("${path.root}/../../../../prompts/v1/incident-agent.md")
    fix-agent      = file("${path.root}/../../../../prompts/v1/fix-agent.md")
  }

  depends_on = [module.bedrock_kb]
}

# ──────────────────────────────────────────────────────────────────────────────
# SQS Queues
# ──────────────────────────────────────────────────────────────────────────────
module "sqs" {
  source      = "../../modules/sqs"
  project     = var.project
  kms_key_arn = module.kms.sqs_key_arn
}

# ──────────────────────────────────────────────────────────────────────────────
# EventBridge
# ──────────────────────────────────────────────────────────────────────────────
module "eventbridge" {
  source  = "../../modules/eventbridge"
  project = var.project
}

# ──────────────────────────────────────────────────────────────────────────────
# Cognito
# ──────────────────────────────────────────────────────────────────────────────
module "cognito" {
  source        = "../../modules/cognito"
  project       = var.project
  domain_prefix = "${var.project}-auth"
  allowed_callback_urls = compact([
    "https://app.${var.domain_name}/auth/callback",
    "http://localhost:5173/auth/callback",
  ])
  allowed_logout_urls = compact([
    "https://app.${var.domain_name}",
    "http://localhost:5173",
  ])
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM Roles — read from global/iam state (already applied in Phase B)
# ──────────────────────────────────────────────────────────────────────────────
data "terraform_remote_state" "iam" {
  backend = "s3"
  config = {
    bucket = "aigo-tf-state"
    key    = "global/iam/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Lambda Functions
# ──────────────────────────────────────────────────────────────────────────────
locals {
  lambda_common_env = {
    STAGE                      = "prod"
    DYNAMODB_TABLE_PREFIX      = var.project
    S3_DIFFS_BUCKET            = module.s3.bucket_names["diffs"]
    S3_REPORTS_BUCKET          = module.s3.bucket_names["reports"]
    S3_AGENT_OUTPUTS_BUCKET    = module.s3.bucket_names["agent_outputs"]
    S3_PATCHES_BUCKET          = module.s3.bucket_names["patches"]
    S3_INCIDENTS_BUCKET        = module.s3.bucket_names["incidents"]
    S3_ARTIFACTS_BUCKET        = module.s3.bucket_names["artifacts"]
    SQS_ANALYSIS_QUEUE_URL     = module.sqs.queue_urls["analysis"]
    SQS_FIX_QUEUE_URL          = module.sqs.queue_urls["fix"]
    SQS_INCIDENT_QUEUE_URL     = module.sqs.queue_urls["incident"]
    SQS_COMMAND_QUEUE_URL      = module.sqs.queue_urls["command"]
    SQS_NOTIFICATION_QUEUE_URL = module.sqs.queue_urls["notification"]
    EVENTBRIDGE_BUS_NAME       = module.eventbridge.bus_name
    COGNITO_USER_POOL_ID       = module.cognito.user_pool_id
    COGNITO_CLIENT_ID          = module.cognito.client_id
    ECS_CLUSTER_ARN            = module.ecs.cluster_arn
    GITHUB_SECRET_ARN          = aws_secretsmanager_secret.github_app.arn
    SLACK_SECRET_ARN           = aws_secretsmanager_secret.slack.arn
    # Bedrock Knowledge Base (kb_tools.py reads BEDROCK_KB_ID, filters by category metadata)
    BEDROCK_KB_ID = module.bedrock_kb.knowledge_base_id
    # Bedrock Agent IDs — lightweight worker (agentcore-client.ts)
    ORCHESTRATOR_AGENT_ID       = module.bedrock_agentcore.agent_ids["orchestrator"]
    ORCHESTRATOR_AGENT_ALIAS_ID = module.bedrock_agentcore.agent_alias_ids["orchestrator"]
    # Bedrock Agent IDs — subagent_tools.py (Code / Infra / Risk / Security)
    CODE_REVIEWER_AGENT_ID  = module.bedrock_agentcore.agent_ids["code-reviewer"]
    CODE_REVIEWER_ALIAS_ID  = module.bedrock_agentcore.agent_alias_ids["code-reviewer"]
    INFRA_REVIEWER_AGENT_ID = module.bedrock_agentcore.agent_ids["infra-reviewer"]
    INFRA_REVIEWER_ALIAS_ID = module.bedrock_agentcore.agent_alias_ids["infra-reviewer"]
    RISK_REVIEWER_AGENT_ID  = module.bedrock_agentcore.agent_ids["risk-reviewer"]
    RISK_REVIEWER_ALIAS_ID  = module.bedrock_agentcore.agent_alias_ids["risk-reviewer"]
    SECURITY_AGENT_ID       = module.bedrock_agentcore.agent_ids["security-agent"]
    SECURITY_ALIAS_ID       = module.bedrock_agentcore.agent_alias_ids["security-agent"]
    # Bedrock Agent IDs — ECS heavy worker / incident worker
    INCIDENT_AGENT_ID       = module.bedrock_agentcore.agent_ids["incident-agent"]
    INCIDENT_AGENT_ALIAS_ID = module.bedrock_agentcore.agent_alias_ids["incident-agent"]
    FIX_AGENT_ID            = module.bedrock_agentcore.agent_ids["fix-agent"]
    FIX_AGENT_ALIAS_ID      = module.bedrock_agentcore.agent_alias_ids["fix-agent"]
  }

  lambda_vpc = {
    subnet_ids         = module.vpc.private_subnet_ids
    security_group_ids = [module.vpc.lambda_security_group_id]
  }
}

module "lambda_github_connector" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "github-connector"
  description           = "GitHub Webhook handler — validates HMAC, creates AnalysisJob"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 512
  timeout               = 30
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/github-connector/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_connector_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_slack_connector" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "slack-connector"
  description           = "Slack Slash Command handler"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 512
  timeout               = 30
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/slack-connector/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_connector_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_dashboard_cmd" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "dashboard-cmd-connector"
  description           = "Dashboard command handler (approve/reject/fix via API)"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 512
  timeout               = 30
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/dashboard-cmd-connector/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_connector_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_aws_event" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "aws-event-connector"
  description           = "AWS event handler (CloudWatch Alarm → incident queue)"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 256
  timeout               = 30
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/aws-event-connector/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_connector_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_dashboard_api" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "dashboard-api"
  description           = "Dashboard REST API (Hono)"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 1024
  timeout               = 29
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/dashboard-api/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_api_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_lightweight_worker" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "lightweight-worker"
  description           = "SQS-triggered analysis worker (fetches PR diff, triggers agents)"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 1024
  timeout               = 900
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/lightweight-worker/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_worker_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

module "lambda_notification_worker" {
  source                = "../../modules/lambda"
  project               = var.project
  function_name         = "notification-worker"
  description           = "Notification dispatcher (Slack messages, GitHub comments)"
  handler               = "index.handler"
  runtime               = "nodejs22.x"
  memory_size           = 512
  timeout               = 60
  s3_bucket             = module.s3.bucket_names["artifacts"]
  s3_key                = "lambda/notification-worker/latest.zip"
  kms_key_arn           = module.kms.lambda_key_arn
  role_arn              = data.terraform_remote_state.iam.outputs.lambda_worker_role_arn
  subnet_ids            = local.lambda_vpc.subnet_ids
  security_group_ids    = local.lambda_vpc.security_group_ids
  environment_variables = local.lambda_common_env
}

# ──────────────────────────────────────────────────────────────────────────────
# API Gateway
# ──────────────────────────────────────────────────────────────────────────────
module "api_gateway" {
  source                = "../../modules/api-gateway"
  project               = var.project
  aws_region            = var.aws_region
  cognito_user_pool_arn = module.cognito.user_pool_arn
  cognito_client_id     = module.cognito.client_id
  cors_allow_origins    = compact(["https://app.${var.domain_name}", "http://localhost:5173"])
  lambda_arns = {
    "POST /webhooks/github"            = module.lambda_github_connector.alias_arn
    "POST /webhooks/slack"             = module.lambda_slack_connector.alias_arn
    "GET /reports"                     = module.lambda_dashboard_api.alias_arn
    "GET /reports/{reportId}"          = module.lambda_dashboard_api.alias_arn
    "POST /reports/{reportId}/approve" = module.lambda_dashboard_cmd.alias_arn
    "POST /reports/{reportId}/reject"  = module.lambda_dashboard_cmd.alias_arn
    "POST /fix"                        = module.lambda_dashboard_cmd.alias_arn
    "GET /fix/{fixId}"                 = module.lambda_dashboard_api.alias_arn
    "POST /fix/{fixId}/approve"        = module.lambda_dashboard_cmd.alias_arn
    "GET /incidents"                   = module.lambda_dashboard_api.alias_arn
    "GET /incidents/{incidentId}"      = module.lambda_dashboard_api.alias_arn
    "GET /fix"                         = module.lambda_dashboard_api.alias_arn
    "GET /jobs"                        = module.lambda_dashboard_api.alias_arn
    "GET /jobs/{jobId}"                = module.lambda_dashboard_api.alias_arn
    "GET /jobs/agent-runs"             = module.lambda_dashboard_api.alias_arn
    "GET /settings"                    = module.lambda_dashboard_api.alias_arn
    "PATCH /settings"                  = module.lambda_dashboard_api.alias_arn
    "GET /health"                      = module.lambda_dashboard_api.alias_arn
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# ECS
# ──────────────────────────────────────────────────────────────────────────────
module "ecs" {
  source             = "../../modules/ecs"
  project            = var.project
  aws_region         = var.aws_region
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.vpc.ecs_security_group_id
  task_role_arn      = data.terraform_remote_state.iam.outputs.ecs_task_role_arn
  execution_role_arn = data.terraform_remote_state.iam.outputs.ecs_execution_role_arn
  kms_key_arn        = module.kms.cloudwatch_key_arn
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudFront
# ──────────────────────────────────────────────────────────────────────────────
module "cloudfront" {
  source              = "../../modules/cloudfront"
  project             = var.project
  frontend_bucket_id  = module.s3.bucket_ids["frontend"]
  frontend_bucket_arn = module.s3.bucket_arns["frontend"]
  api_domain          = replace(module.api_gateway.stage_invoke_url, "https://", "")
  domain_name         = var.domain_name
}

# ──────────────────────────────────────────────────────────────────────────────
# SQS Event Source Mappings (Lambda triggers)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_lambda_event_source_mapping" "analysis" {
  event_source_arn                   = module.sqs.queue_arns["analysis"]
  function_name                      = module.lambda_lightweight_worker.alias_arn
  batch_size                         = 1
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
}

resource "aws_lambda_event_source_mapping" "notification" {
  event_source_arn                   = module.sqs.queue_arns["notification"]
  function_name                      = module.lambda_notification_worker.alias_arn
  batch_size                         = 10
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 5
}

# ──────────────────────────────────────────────────────────────────────────────
# Secrets Manager (secrets created empty — values set via CI/CD or console)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "github_app" {
  name                    = "${var.project}/github/app-credentials"
  description             = "GitHub App private key and secrets"
  kms_key_id              = module.kms.lambda_key_arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret" "slack" {
  name                    = "${var.project}/slack/bot-token"
  description             = "Slack Bot Token and Signing Secret"
  kms_key_id              = module.kms.lambda_key_arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret" "github_webhook" {
  name                    = "${var.project}/github/webhook-secret"
  description             = "GitHub Webhook HMAC secret for signature validation"
  kms_key_id              = module.kms.lambda_key_arn
  recovery_window_in_days = 30
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudWatch Alarms SNS Topic
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_sns_topic" "alarms" {
  name = "${var.project}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ──────────────────────────────────────────────────────────────────────────────
# Monitoring — CloudWatch Log Groups, Alarms, Dashboard
# ──────────────────────────────────────────────────────────────────────────────
module "monitoring" {
  source = "../../modules/monitoring"

  project        = var.project
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id
  kms_key_arn    = module.kms.cloudwatch_key_arn

  sns_alarm_topic_arn = aws_sns_topic.alarms.arn
  api_gateway_id      = module.api_gateway.api_id

  lambda_function_names = [
    "${var.project}-github-connector",
    "${var.project}-slack-connector",
    "${var.project}-dashboard-api",
    "${var.project}-dashboard-cmd",
    "${var.project}-lightweight-worker",
    "${var.project}-notification-worker",
  ]

  sqs_dlq_names = [
    "${var.project}-analysis-dlq.fifo",
    "${var.project}-fix-dlq.fifo",
    "${var.project}-incident-dlq.fifo",
    "${var.project}-command-dlq.fifo",
    "${var.project}-notification-dlq",
  ]

  log_retention_days = 90
  tags               = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# Security — WAF, GuardDuty, CloudTrail
# ──────────────────────────────────────────────────────────────────────────────
module "security" {
  source = "../../modules/security"

  project        = var.project
  aws_region     = var.aws_region
  aws_account_id = var.aws_account_id

  api_gateway_arn      = ""
  s3_audit_bucket_name = module.s3.bucket_names["logs"]
  kms_key_arn          = module.kms.cloudwatch_key_arn
  sns_alarm_topic_arn  = aws_sns_topic.alarms.arn

  tags = local.common_tags
}
