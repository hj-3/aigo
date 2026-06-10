locals {
  p           = var.project
  common_tags = merge(var.tags, { Project = var.project, ManagedBy = "terraform" })

  # Naming-convention-based ARN patterns (scoped to this account + project prefix).
  # Avoids chicken-and-egg dependency on envs/prod outputs at Phase B.
  ddb_arns = [
    "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${local.p}-*",
  ]
  s3_arns = [
    "arn:aws:s3:::${local.p}-*",
    "arn:aws:s3:::${local.p}-*/*",
  ]
  sqs_arns = [
    "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:${local.p}-*",
  ]
  kms_arns = [
    "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*",
  ]
  eb_arn = "arn:aws:events:${var.aws_region}:${var.aws_account_id}:event-bus/${local.p}-*"
}

# ──────────────────────────────────────────────────────────────────────────────
# GitHub OIDC Provider (for CI/CD — no long-lived credentials)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1",
  "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

resource "aws_iam_role" "github_actions_deploy" {
  name = "${local.p}-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/*:*"
        }
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "github_actions_core" {
  name = "${local.p}-github-actions-core"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaDeploy"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:UpdateAlias",
          "lambda:GetFunction",
          "lambda:GetAlias",
          "lambda:PublishVersion",
          "lambda:ListVersionsByFunction",
          "lambda:CreateAlias",
          "lambda:UpdateFunctionConfiguration",
        ]
        Resource = "arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:${local.p}-*"
      },
      {
        Sid      = "S3ArtifactsDeploy"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${local.p}-artifacts/*"
      },
      {
        Sid    = "S3AgentPackagesDeploy"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${local.p}-agent-packages",
          "arn:aws:s3:::${local.p}-agent-packages/*"
        ]
      },
      {
        Sid      = "CloudFrontInvalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = "*"
      },
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${local.p}-tf-state",
          "arn:aws:s3:::${local.p}-tf-state/*"
        ]
      },
      {
        Sid      = "TerraformLock"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${local.p}-tf-lock"
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = local.kms_arns
      },
      {
        Sid    = "BedrockAgentDeploy"
        Effect = "Allow"
        Action = [
          "bedrock:PrepareAgent",
          "bedrock:CreateAgentVersion",
          "bedrock:UpdateAgent",
          "bedrock:GetAgent",
          "bedrock:UpdateAgentAlias",
          "bedrock:GetAgentAlias",
          "bedrock:ListAgentVersions"
        ]
        Resource = "arn:aws:bedrock:${var.aws_region}:${var.aws_account_id}:agent/*"
      },
      {
        Sid      = "SSMRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/${local.p}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_core" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.github_actions_core.arn
}

# ──────────────────────────────────────────────────────────────────────────────
# Lambda Execution Roles
# ──────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Connector Lambda Role (GitHub, Slack, Dashboard-cmd, AWS-event)
resource "aws_iam_role" "lambda_connector" {
  name               = "${local.p}-lambda-connector-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_connector_vpc" {
  role       = aws_iam_role.lambda_connector.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_connector_xray" {
  role       = aws_iam_role.lambda_connector.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "lambda_connector" {
  name = "${local.p}-lambda-connector-policy"
  role = aws_iam_role.lambda_connector.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SQSSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
        Resource = local.sqs_arns
      },
      {
        Sid    = "DynamoReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:Query", "dynamodb:BatchWriteItem"
        ]
        Resource = local.ddb_arns
      },
      {
        Sid      = "SecretsRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:${local.p}/*"
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = local.kms_arns
      },
      {
        Sid      = "EventBridge"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = local.eb_arn
      }
    ]
  })
}

# Dashboard API Lambda Role
resource "aws_iam_role" "lambda_api" {
  name               = "${local.p}-lambda-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_api_vpc" {
  role       = aws_iam_role.lambda_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_api_xray" {
  role       = aws_iam_role.lambda_api.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "lambda_api" {
  name = "${local.p}-lambda-api-policy"
  role = aws_iam_role.lambda_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:Query", "dynamodb:BatchGetItem"
        ]
        Resource = local.ddb_arns
      },
      {
        Sid      = "S3Read"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = local.s3_arns
      },
      {
        Sid      = "SecretsRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:${local.p}/*"
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = local.kms_arns
      }
    ]
  })
}

# Worker Lambda Role
resource "aws_iam_role" "lambda_worker" {
  name               = "${local.p}-lambda-worker-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_worker_vpc" {
  role       = aws_iam_role.lambda_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_worker_xray" {
  role       = aws_iam_role.lambda_worker.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "lambda_worker" {
  name = "${local.p}-lambda-worker-policy"
  role = aws_iam_role.lambda_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage", "sqs:DeleteMessage",
          "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility",
          "sqs:SendMessage"
        ]
        Resource = local.sqs_arns
      },
      {
        Sid    = "DynamoReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:Query", "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems"
        ]
        Resource = local.ddb_arns
      },
      {
        Sid      = "S3ReadWrite"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:HeadObject"]
        Resource = local.s3_arns
      },
      {
        Sid      = "SecretsRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:${local.p}/*"
      },
      {
        Sid      = "ECSRunTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask", "ecs:DescribeTasks"]
        Resource = "*"
      },
      {
        Sid      = "PassRoleECS"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${var.aws_account_id}:role/${local.p}-ecs-*"
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = local.kms_arns
      },
      {
        Sid      = "EventBridge"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = local.eb_arn
      }
    ]
  })
}

# ECS Task Role
resource "aws_iam_role" "ecs_task" {
  name = "${local.p}-ecs-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.p}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query",
          "s3:GetObject", "s3:PutObject",
          "secretsmanager:GetSecretValue",
          "kms:Decrypt", "kms:GenerateDataKey",
        ]
        Resource = "*"
      }
    ]
  })
}

# ECS Execution Role
resource "aws_iam_role" "ecs_execution" {
  name = "${local.p}-ecs-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_ecr" {
  name = "${local.p}-ecs-execution-extra"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = local.kms_arns
    }]
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Additional permissions for GitHub Actions Terraform apply
# (Terraform must Read existing resources during plan/refresh phase)
# Implemented as managed policies (not inline) to avoid the 10,240-byte
# combined inline policy limit per IAM role.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_iam_policy" "github_actions_tf_compute" {
  name = "${local.p}-github-actions-tf-compute"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EC2VPC"
        Effect = "Allow"
        Action = [
          "ec2:DescribeVpcs", "ec2:DescribeVpcAttribute",
          "ec2:DescribeSubnets", "ec2:DescribeRouteTables",
          "ec2:DescribeInternetGateways", "ec2:DescribeNatGateways",
          "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcEndpoints", "ec2:DescribeFlowLogs",
          "ec2:DescribeNetworkAcls", "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeAvailabilityZones", "ec2:DescribeTags",
          "ec2:DescribeAccountAttributes",
          "ec2:CreateVpc", "ec2:DeleteVpc", "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet", "ec2:DeleteSubnet", "ec2:ModifySubnetAttribute",
          "ec2:CreateInternetGateway", "ec2:AttachInternetGateway",
          "ec2:DetachInternetGateway", "ec2:DeleteInternetGateway",
          "ec2:AllocateAddress", "ec2:ReleaseAddress",
          "ec2:AssociateAddress", "ec2:DisassociateAddress",
          "ec2:CreateNatGateway", "ec2:DeleteNatGateway",
          "ec2:CreateRouteTable", "ec2:DeleteRouteTable",
          "ec2:CreateRoute", "ec2:DeleteRoute",
          "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable",
          "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
          "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
          "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          "ec2:CreateVpcEndpoint", "ec2:DeleteVpcEndpoints", "ec2:ModifyVpcEndpoint",
          "ec2:DescribeVpcEndpointServices",
          "ec2:CreateFlowLogs", "ec2:DeleteFlowLogs",
          "ec2:CreateTags", "ec2:DeleteTags",
        ]
        Resource = "*"
      },
      {
        Sid    = "ECS"
        Effect = "Allow"
        Action = [
          "ecs:CreateCluster", "ecs:DescribeClusters", "ecs:DeleteCluster",
          "ecs:UpdateCluster", "ecs:UpdateClusterSettings",
          "ecs:PutClusterCapacityProviders",
          "ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:CreateService", "ecs:DescribeServices",
          "ecs:UpdateService", "ecs:DeleteService",
          "ecs:TagResource", "ecs:UntagResource", "ecs:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "ECR"
        Effect = "Allow"
        Action = [
          "ecr:CreateRepository", "ecr:DescribeRepositories",
          "ecr:DeleteRepository", "ecr:SetRepositoryPolicy",
          "ecr:GetRepositoryPolicy", "ecr:DeleteRepositoryPolicy",
          "ecr:PutLifecyclePolicy", "ecr:GetLifecyclePolicy", "ecr:DeleteLifecyclePolicy",
          "ecr:PutImageScanningConfiguration", "ecr:PutImageTagMutability",
          "ecr:TagResource", "ecr:UntagResource", "ecr:ListTagsForResource",
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage", "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_tf_compute" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.github_actions_tf_compute.arn
}

resource "aws_iam_policy" "github_actions_tf_app" {
  name = "${local.p}-github-actions-tf-app"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SNS"
        Effect = "Allow"
        Action = [
          "sns:CreateTopic", "sns:GetTopicAttributes", "sns:SetTopicAttributes",
          "sns:DeleteTopic", "sns:Subscribe", "sns:Unsubscribe",
          "sns:ListSubscriptionsByTopic", "sns:GetSubscriptionAttributes",
          "sns:SetSubscriptionAttributes",
          "sns:TagResource", "sns:UntagResource", "sns:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatch"
        Effect = "Allow"
        Action = [
          "cloudwatch:DescribeAlarms", "cloudwatch:PutMetricAlarm",
          "cloudwatch:DeleteAlarms", "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics", "cloudwatch:TagResource",
          "cloudwatch:UntagResource", "cloudwatch:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:DescribeLogGroups", "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
          "logs:AssociateKmsKey", "logs:DisassociateKmsKey",
          "logs:ListTagsLogGroup", "logs:TagLogGroup", "logs:UntagLogGroup",
          "logs:ListTagsForResource", "logs:TagResource", "logs:UntagResource",
          "logs:DescribeLogStreams",
        ]
        Resource = "*"
      },
      {
        Sid    = "EventBridge"
        Effect = "Allow"
        Action = [
          "events:CreateEventBus", "events:DescribeEventBus", "events:DeleteEventBus",
          "events:PutRule", "events:DescribeRule", "events:DeleteRule",
          "events:EnableRule", "events:DisableRule",
          "events:PutTargets", "events:ListTargetsByRule", "events:RemoveTargets",
          "events:PutPermission", "events:RemovePermission",
          "events:TagResource", "events:UntagResource", "events:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "EventBridgeSchemas"
        Effect = "Allow"
        Action = [
          "schemas:CreateRegistry", "schemas:DescribeRegistry",
          "schemas:UpdateRegistry", "schemas:DeleteRegistry",
          "schemas:CreateSchema", "schemas:DescribeSchema",
          "schemas:UpdateSchema", "schemas:DeleteSchema",
          "schemas:TagResource", "schemas:UntagResource", "schemas:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "Cognito"
        Effect = "Allow"
        Action = [
          "cognito-idp:CreateUserPool", "cognito-idp:DescribeUserPool",
          "cognito-idp:UpdateUserPool", "cognito-idp:DeleteUserPool",
          "cognito-idp:CreateUserPoolClient", "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:UpdateUserPoolClient", "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:CreateUserPoolDomain", "cognito-idp:DescribeUserPoolDomain",
          "cognito-idp:DeleteUserPoolDomain",
          "cognito-idp:AddCustomAttributes",
          "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:SetUserPoolMfaConfig",
          "cognito-idp:CreateIdentityProvider", "cognito-idp:DescribeIdentityProvider",
          "cognito-idp:UpdateIdentityProvider", "cognito-idp:DeleteIdentityProvider",
          "cognito-idp:CreateResourceServer", "cognito-idp:DescribeResourceServer",
          "cognito-idp:UpdateResourceServer", "cognito-idp:DeleteResourceServer",
          "cognito-idp:TagResource", "cognito-idp:UntagResource",
          "cognito-idp:ListTagsForResource",
          "cognito-idp:CreateGroup", "cognito-idp:GetGroup",
          "cognito-idp:UpdateGroup", "cognito-idp:DeleteGroup",
          "cognito-idp:SetUICustomization", "cognito-idp:GetUICustomization",
        ]
        Resource = "*"
      },
      {
        Sid    = "APIGateway"
        Effect = "Allow"
        Action = [
          "apigateway:GET", "apigateway:POST", "apigateway:PUT",
          "apigateway:PATCH", "apigateway:DELETE",
        ]
        Resource = "arn:aws:apigateway:${var.aws_region}::/*"
      },
      {
        Sid    = "CloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution", "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution", "cloudfront:ListDistributions",
          "cloudfront:CreateOriginAccessControl", "cloudfront:GetOriginAccessControl",
          "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl",
          "cloudfront:ListOriginAccessControls",
          "cloudfront:CreateResponseHeadersPolicy", "cloudfront:GetResponseHeadersPolicy",
          "cloudfront:UpdateResponseHeadersPolicy", "cloudfront:DeleteResponseHeadersPolicy",
          "cloudfront:ListResponseHeadersPolicies",
          "cloudfront:ListCachePolicies", "cloudfront:GetCachePolicy",
          "cloudfront:CreateCachePolicy", "cloudfront:UpdateCachePolicy", "cloudfront:DeleteCachePolicy",
          "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "WAFv2"
        Effect = "Allow"
        Action = [
          "wafv2:CreateWebACL", "wafv2:GetWebACL", "wafv2:UpdateWebACL",
          "wafv2:DeleteWebACL", "wafv2:ListWebACLs",
          "wafv2:AssociateWebACL", "wafv2:DisassociateWebACL",
          "wafv2:GetWebACLForResource",
          "wafv2:CreateIPSet", "wafv2:GetIPSet", "wafv2:UpdateIPSet", "wafv2:DeleteIPSet",
          "wafv2:CreateRuleGroup", "wafv2:GetRuleGroup",
          "wafv2:UpdateRuleGroup", "wafv2:DeleteRuleGroup",
          "wafv2:GetLoggingConfiguration", "wafv2:PutLoggingConfiguration",
          "wafv2:DeleteLoggingConfiguration",
          "wafv2:ListTagsForResource", "wafv2:TagResource", "wafv2:UntagResource",
          "wafv2:CheckCapacity", "wafv2:DescribeManagedRuleGroup",
          "wafv2:ListManagedRuleSets", "wafv2:ListAvailableManagedRuleGroups",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_tf_app" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.github_actions_tf_app.arn
}

resource "aws_iam_policy" "github_actions_tf_iam_kms" {
  name = "${local.p}-github-actions-tf-iam-kms"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "IAMManage"
        Effect = "Allow"
        Action = [
          "iam:GetRole", "iam:CreateRole", "iam:UpdateRole", "iam:DeleteRole",
          "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
          "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
          "iam:PassRole",
          "iam:GetOpenIDConnectProvider", "iam:CreateOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviders",
          "iam:AddClientIDToOpenIDConnectProvider",
          "iam:RemoveClientIDFromOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:GetPolicy", "iam:CreatePolicy", "iam:DeletePolicy",
          "iam:CreatePolicyVersion", "iam:DeletePolicyVersion",
          "iam:GetPolicyVersion", "iam:ListPolicyVersions",
          "iam:SetDefaultPolicyVersion",
        ]
        Resource = "*"
      },
      {
        Sid    = "KMSFull"
        Effect = "Allow"
        Action = [
          "kms:CreateKey", "kms:DescribeKey", "kms:GetKeyPolicy",
          "kms:PutKeyPolicy", "kms:EnableKeyRotation", "kms:DisableKeyRotation",
          "kms:GetKeyRotationStatus", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
          "kms:EnableKey", "kms:DisableKey",
          "kms:CreateAlias", "kms:UpdateAlias", "kms:DeleteAlias", "kms:ListAliases",
          "kms:TagResource", "kms:UntagResource", "kms:ListResourceTags", "kms:ListKeys",
          "kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant", "kms:RetireGrant",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_tf_iam_kms" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.github_actions_tf_iam_kms.arn
}

resource "aws_iam_policy" "github_actions_tf_data_sec" {
  name = "${local.p}-github-actions-tf-data-sec"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3BucketManage"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:ListAllMyBuckets",
          "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
          "s3:GetBucketVersioning", "s3:PutBucketVersioning",
          "s3:GetBucketEncryption", "s3:PutBucketEncryption",
          "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration",
          "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketLogging", "s3:PutBucketLogging",
          "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:DeleteBucketTagging",
          "s3:GetBucketNotification", "s3:PutBucketNotification",
          "s3:GetBucketCORS", "s3:PutBucketCORS", "s3:DeleteBucketCORS",
          "s3:GetBucketObjectLockConfiguration", "s3:PutBucketObjectLockConfiguration",
          "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration",
          "s3:GetBucketReplication", "s3:PutBucketReplication", "s3:DeleteBucketReplication",
          "s3:GetBucketOwnershipControls", "s3:PutBucketOwnershipControls",
          "s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketVersions",
          "s3:GetBucketWebsite", "s3:PutBucketWebsite", "s3:DeleteBucketWebsite",
          "s3:GetBucketAcl", "s3:PutBucketAcl",
          "s3:GetAccelerateConfiguration", "s3:PutAccelerateConfiguration",
        ]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBManage"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:UpdateTable",
          "dynamodb:DeleteTable", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive",
          "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups",
          "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource",
          "dynamodb:DescribeLimits", "dynamodb:ListTables",
          "dynamodb:DescribeTableReplicaAutoScaling",
        ]
        Resource = "*"
      },
      {
        Sid    = "SQSManage"
        Effect = "Allow"
        Action = [
          "sqs:CreateQueue", "sqs:GetQueueAttributes", "sqs:SetQueueAttributes",
          "sqs:DeleteQueue", "sqs:GetQueueUrl", "sqs:ListQueues",
          "sqs:ListQueueTags", "sqs:TagQueue", "sqs:UntagQueue",
          "sqs:AddPermission", "sqs:RemovePermission",
        ]
        Resource = "*"
      },
      {
        Sid    = "SecretsManagerManage"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecret", "secretsmanager:DeleteSecret",
          "secretsmanager:RestoreSecret",
          "secretsmanager:PutResourcePolicy", "secretsmanager:GetResourcePolicy",
          "secretsmanager:DeleteResourcePolicy",
          "secretsmanager:TagResource", "secretsmanager:UntagResource",
          "secretsmanager:ListSecrets", "secretsmanager:ListSecretVersionIds",
          "secretsmanager:RotateSecret", "secretsmanager:CancelRotateSecret",
        ]
        Resource = "*"
      },
      {
        Sid    = "GuardDuty"
        Effect = "Allow"
        Action = [
          "guardduty:CreateDetector", "guardduty:GetDetector",
          "guardduty:UpdateDetector", "guardduty:DeleteDetector", "guardduty:ListDetectors",
          "guardduty:CreateFilter", "guardduty:GetFilter",
          "guardduty:UpdateFilter", "guardduty:DeleteFilter", "guardduty:ListFilters",
          "guardduty:TagResource", "guardduty:UntagResource", "guardduty:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "OpenSearchServerless"
        Effect = "Allow"
        Action = [
          "aoss:CreateCollection", "aoss:GetCollection", "aoss:BatchGetCollection",
          "aoss:UpdateCollection", "aoss:DeleteCollection", "aoss:ListCollections",
          "aoss:CreateSecurityPolicy", "aoss:GetSecurityPolicy",
          "aoss:UpdateSecurityPolicy", "aoss:DeleteSecurityPolicy", "aoss:ListSecurityPolicies",
          "aoss:CreateAccessPolicy", "aoss:GetAccessPolicy",
          "aoss:UpdateAccessPolicy", "aoss:DeleteAccessPolicy", "aoss:ListAccessPolicies",
          "aoss:CreateVpcEndpoint", "aoss:GetVpcEndpoint", "aoss:BatchGetVpcEndpoint",
          "aoss:UpdateVpcEndpoint", "aoss:DeleteVpcEndpoint", "aoss:ListVpcEndpoints",
          "aoss:TagResource", "aoss:UntagResource", "aoss:ListTagsForResource",
          "aoss:APIAccessAll", "aoss:DashboardsAccessAll",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_tf_data_sec" {
  role       = aws_iam_role.github_actions_deploy.name
  policy_arn = aws_iam_policy.github_actions_tf_data_sec.arn
}
