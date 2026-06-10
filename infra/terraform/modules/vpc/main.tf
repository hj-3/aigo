locals {
  name_prefix = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "vpc"
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# VPC
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpc" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Internet Gateway
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-igw" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Public Subnets
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnets[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-${var.azs[count.index]}"
    Tier = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-rt-public" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ──────────────────────────────────────────────────────────────────────────────
# Elastic IPs + NAT Gateways (one per AZ for HA)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? length(var.azs) : 0
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-nat-eip-${var.azs[count.index]}" })
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat_gateway ? length(var.azs) : 0
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.this]
  tags          = merge(local.common_tags, { Name = "${local.name_prefix}-nat-${var.azs[count.index]}" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Private Subnets (Lambda/ECS — has NAT access for GitHub API, Slack API)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnets[count.index]
  availability_zone = var.azs[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-${var.azs[count.index]}"
    Tier = "private"
  })
}

resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-rt-private-${var.azs[count.index]}" })
}

resource "aws_route" "private_nat" {
  count                  = var.enable_nat_gateway ? length(var.azs) : 0
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[count.index].id
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ──────────────────────────────────────────────────────────────────────────────
# Isolated Subnets (AgentCore MCP server — VPC Endpoints only, no NAT)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_subnet" "isolated" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.isolated_subnets[count.index]
  availability_zone = var.azs[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-isolated-${var.azs[count.index]}"
    Tier = "isolated"
  })
}

resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${local.name_prefix}-rt-isolated" })
}

resource "aws_route_table_association" "isolated" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# ──────────────────────────────────────────────────────────────────────────────
# VPC Flow Logs
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/aws/vpc/flowlogs/${local.name_prefix}"
  retention_in_days = 90
  tags              = local.common_tags
}

resource "aws_iam_role" "vpc_flow_logs" {
  name = "${local.name_prefix}-vpc-flow-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "vpc_flow_logs" {
  name = "${local.name_prefix}-vpc-flow-logs-policy"
  role = aws_iam_role.vpc_flow_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ]
      Resource = "${aws_cloudwatch_log_group.vpc_flow_logs.arn}:*"
    }]
  })
}

resource "aws_flow_log" "this" {
  iam_role_arn    = aws_iam_role.vpc_flow_logs.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.this.id
  tags            = merge(local.common_tags, { Name = "${local.name_prefix}-flow-log" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Security Groups
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda-sg"
  description = "Security group for Lambda functions in private subnets"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound (NAT for SaaS APIs, VPC Endpoints for AWS services)"
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-lambda-sg" })
}

resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs-sg"
  description = "Security group for ECS Fargate tasks"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-ecs-sg" })
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name_prefix}-vpc-endpoints-sg"
  description = "Security group for VPC Interface Endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id, aws_security_group.ecs.id]
    description     = "HTTPS from Lambda and ECS"
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpc-endpoints-sg" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Gateway VPC Endpoints (S3, DynamoDB — free, no per-hour cost)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids = concat(
    aws_route_table.private[*].id,
    [aws_route_table.isolated.id]
  )
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpce-s3" })
}

resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids = concat(
    aws_route_table.private[*].id,
    [aws_route_table.isolated.id]
  )
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpce-dynamodb" })
}

# ──────────────────────────────────────────────────────────────────────────────
# Interface VPC Endpoints
# ──────────────────────────────────────────────────────────────────────────────
locals {
  interface_endpoints = {
    ecr_api    = "com.amazonaws.${var.region}.ecr.api"
    ecr_dkr    = "com.amazonaws.${var.region}.ecr.dkr"
    logs       = "com.amazonaws.${var.region}.logs"
    secretsmanager = "com.amazonaws.${var.region}.secretsmanager"
    kms        = "com.amazonaws.${var.region}.kms"
    sts        = "com.amazonaws.${var.region}.sts"
    sqs        = "com.amazonaws.${var.region}.sqs"
    events     = "com.amazonaws.${var.region}.events"
    ssm        = "com.amazonaws.${var.region}.ssm"
    xray       = "com.amazonaws.${var.region}.xray"
    bedrock    = "com.amazonaws.${var.region}.bedrock-runtime"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.this.id
  service_name        = each.value
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-vpce-${each.key}" })
}
