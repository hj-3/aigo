data "aws_caller_identity" "current" {}

locals {
  p   = var.project
  col = "${var.project}-vectors"

  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "bedrock-kb"
  })

  # Normalize STS assumed-role session ARN → IAM role ARN for AOSS data access policy.
  # AOSS accepts IAM user ARNs and IAM role ARNs, not STS session ARNs.
  _caller_arn = data.aws_caller_identity.current.arn
  deploy_principal = strcontains(local._caller_arn, ":assumed-role/") ? (
    "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${split("/", local._caller_arn)[1]}"
  ) : local._caller_arn

  # Four data source domains within a single KB.
  # Each document under the S3 prefix must carry a sidecar
  # `{filename}.metadata.json` with {"metadataAttributes":{"category":"<tag>"}}
  # so that kb_tools.py can filter by category at query time.
  kb_data_sources = {
    coding = {
      s3_prefix = "coding-standards/"
      category  = "coding_standards"
    }
    infrastructure = {
      s3_prefix = "infrastructure-standards/"
      category  = "infrastructure"
    }
    security = {
      s3_prefix = "security-policies/"
      category  = "security"
    }
    risk = {
      s3_prefix = "risk-policies/"
      category  = "risk"
    }
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# IAM — Bedrock Knowledge Base service role
# Ref: https://docs.aws.amazon.com/bedrock/latest/userguide/kb-permissions.html
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "bedrock_kb" {
  name = "${local.p}-bedrock-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = var.aws_account_id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:aws:bedrock:${var.aws_region}:${var.aws_account_id}:knowledge-base/*"
        }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "bedrock_kb" {
  name = "${local.p}-bedrock-kb-policy"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Read"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          var.kb_bucket_arn,
          "${var.kb_bucket_arn}/*"
        ]
      },
      {
        Sid      = "AOSSAccess"
        Effect   = "Allow"
        Action   = ["aoss:APIAccessAll"]
        Resource = "arn:aws:aoss:${var.aws_region}:${var.aws_account_id}:collection/*"
      },
      {
        Sid      = "EmbeddingModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0"
      }
    ]
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# OpenSearch Serverless — vector store for the Knowledge Base
# Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/opensearchserverless_collection
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_opensearchserverless_security_policy" "encryption" {
  name        = "${local.p}-kb-enc"
  type        = "encryption"
  description = "Encryption policy for ${local.p} KB vector store"

  policy = jsonencode({
    Rules = [{
      ResourceType = "collection"
      Resource     = ["collection/${local.col}"]
    }]
    AWSOwnedKey = true
  })
}

resource "aws_opensearchserverless_security_policy" "network" {
  name        = "${local.p}-kb-net"
  type        = "network"
  description = "Network policy — public required for Bedrock KB service to access AOSS"

  # AllowFromPublic is standard for Bedrock KB + AOSS integration.
  # IAM resource policy (data access policy) provides the actual access control.
  policy = jsonencode([{
    Rules = [
      { ResourceType = "collection", Resource = ["collection/${local.col}"] },
      { ResourceType = "dashboard", Resource = ["collection/${local.col}"] }
    ]
    AllowFromPublic = true
  }])
}

resource "aws_opensearchserverless_access_policy" "bedrock_kb" {
  name        = "${local.p}-kb-access"
  type        = "data"
  description = "Data access for Bedrock KB service role"

  policy = jsonencode([{
    Rules = [
      {
        ResourceType = "index"
        Resource     = ["index/${local.col}/*"]
        Permission = [
          "aoss:CreateIndex",
          "aoss:DeleteIndex",
          "aoss:UpdateIndex",
          "aoss:DescribeIndex",
          "aoss:ReadDocument",
          "aoss:WriteDocument"
        ]
      },
      {
        ResourceType = "collection"
        Resource     = ["collection/${local.col}"]
        Permission = [
          "aoss:CreateCollectionItems",
          "aoss:DescribeCollectionItems",
          "aoss:UpdateCollectionItems"
        ]
      }
    ]
    Principal = [
      aws_iam_role.bedrock_kb.arn,
      local.deploy_principal
    ]
  }])
}

resource "aws_opensearchserverless_collection" "vectors" {
  name        = local.col
  type        = "VECTORSEARCH"
  description = "${var.project} Bedrock Knowledge Base vector store"

  tags = local.common_tags

  depends_on = [
    aws_opensearchserverless_security_policy.encryption,
    aws_opensearchserverless_security_policy.network,
    aws_opensearchserverless_access_policy.bedrock_kb,
  ]
}

# ──────────────────────────────────────────────────────────────────────────────
# Bedrock Knowledge Base — single KB, all four domains
# kb_tools.py reads BEDROCK_KB_ID and differentiates by metadata category filter.
# Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/bedrockagent_knowledge_base
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_bedrockagent_knowledge_base" "main" {
  name        = "${local.p}-knowledge-base"
  description = "AgentOps unified Knowledge Base (coding, infrastructure, security, risk)"
  role_arn    = aws_iam_role.bedrock_kb.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"
    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.vectors.arn
      vector_index_name = "${local.p}-kb-index"
      field_mapping {
        vector_field   = "embedding"
        text_field     = "text"
        metadata_field = "metadata"
      }
    }
  }

  tags = local.common_tags

  depends_on = [
    aws_iam_role_policy.bedrock_kb,
  ]
}

# ──────────────────────────────────────────────────────────────────────────────
# Data Sources — one per domain category, each from a dedicated S3 prefix
# Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/bedrockagent_data_source
# ──────────────────────────────────────────────────────────────────────────────
resource "aws_bedrockagent_data_source" "categories" {
  for_each = local.kb_data_sources

  knowledge_base_id = aws_bedrockagent_knowledge_base.main.id
  name              = "${local.p}-ds-${each.key}"

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn         = var.kb_bucket_arn
      inclusion_prefixes = [each.value.s3_prefix]
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"
      fixed_size_chunking_configuration {
        max_tokens         = 512
        overlap_percentage = 20
      }
    }
  }
}
