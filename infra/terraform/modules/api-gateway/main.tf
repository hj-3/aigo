locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "api-gateway"
  })
}

resource "aws_apigatewayv2_api" "main" {
  name          = "${local.p}-api"
  protocol_type = "HTTP"
  description   = "AgentOps Platform HTTP API"

  cors_configuration {
    allow_origins     = var.cors_allow_origins
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers     = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key", "X-Requested-With"]
    expose_headers    = ["X-Request-Id"]
    allow_credentials = true
    max_age           = 86400
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "prod"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      sourceIp         = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      protocol         = "$context.protocol"
      httpMethod       = "$context.httpMethod"
      resourcePath     = "$context.resourcePath"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.p}"
  retention_in_days = 30
  tags              = local.common_tags
}

# ──────────────────────────────────────────────────────────────────────────────
# JWT Authorizer (Cognito)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-authorizer"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${split("/", var.cognito_user_pool_arn)[length(split("/", var.cognito_user_pool_arn)) - 1]}"
  }
}


# ──────────────────────────────────────────────────────────────────────────────
# Lambda Integrations and Routes
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_integration" "lambda" {
  for_each = var.lambda_arns

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = var.lambda_arns

  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambda[each.key].id}"
  authorization_type = startswith(each.key, "POST /webhooks") ? "NONE" : "JWT"
  authorizer_id      = startswith(each.key, "POST /webhooks") ? null : aws_apigatewayv2_authorizer.cognito.id
}

# Allow API Gateway to invoke each unique Lambda alias
locals {
  unique_lambda_arns = toset(values(var.lambda_arns))
}

resource "aws_lambda_permission" "api_gateway" {
  for_each = local.unique_lambda_arns

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = element(split(":", each.value), 6)
  qualifier     = element(split(":", each.value), 7)
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
