locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "ecs"
  })
}

resource "aws_ecs_cluster" "main" {
  name = "${local.p}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# ECR Repository (Heavy Worker image)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_ecr_repository" "heavy_worker" {
  name                 = "${local.p}-worker-heavy"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "heavy_worker" {
  repository = aws_ecr_repository.heavy_worker.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Heavy Worker Task Definition (Python ECS Fargate — repo clone, test, patch)
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "heavy_worker" {
  name              = "${var.logs_group_prefix}/${local.p}/heavy-worker"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = local.common_tags
}

resource "aws_ecs_task_definition" "heavy_worker" {
  family                   = "${local.p}-heavy-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "2048" # 2 vCPU
  memory                   = "4096" # 4 GB
  task_role_arn            = var.task_role_arn
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "heavy-worker"
      image     = "placeholder" # Updated by CI/CD
      essential = true

      environment = concat(
        [
          { name = "STAGE", value = "prod" },
          { name = "SERVICE_NAME", value = "${local.p}-heavy-worker" },
          { name = "LOG_LEVEL", value = "INFO" },
          { name = "AWS_REGION", value = var.aws_region },
          { name = "DYNAMODB_TABLE_PREFIX", value = var.project },
        ],
        [for k, v in var.container_environment : { name = k, value = v }]
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.heavy_worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      readonlyRootFilesystem = false
      user                   = "1000:1000"
    }
  ])

  tags = merge(local.common_tags, { Name = "${local.p}-heavy-worker" })
}

