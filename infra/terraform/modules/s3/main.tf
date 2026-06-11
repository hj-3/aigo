locals {
  p = var.project
  common_tags = merge(var.tags, {
    Project   = var.project
    ManagedBy = "terraform"
    Module    = "s3"
  })

  buckets = {
    frontend       = { versioning = true, lifecycle_days = 0 }
    artifacts      = { versioning = true, lifecycle_days = 90 }
    diffs          = { versioning = false, lifecycle_days = 30 }
    reports        = { versioning = true, lifecycle_days = 365 }
    agent_outputs  = { versioning = false, lifecycle_days = 30 }
    patches        = { versioning = true, lifecycle_days = 90 }
    incidents      = { versioning = true, lifecycle_days = 365 }
    kb             = { versioning = true, lifecycle_days = 0 }
    agent_packages = { versioning = true, lifecycle_days = 180 }
    logs           = { versioning = true, lifecycle_days = 90 }
  }
}

resource "aws_s3_bucket" "buckets" {
  for_each = local.buckets
  bucket   = "${local.p}-${replace(each.key, "_", "-")}"
  tags     = merge(local.common_tags, { Name = "${local.p}-${replace(each.key, "_", "-")}" })
}

resource "aws_s3_bucket_versioning" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id

  versioning_configuration {
    status = each.value.versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "buckets" {
  for_each   = { for k, v in local.buckets : k => v if v.lifecycle_days > 0 }
  bucket     = aws_s3_bucket.buckets[each.key].id
  depends_on = [aws_s3_bucket_versioning.buckets]

  rule {
    id     = "expire-objects"
    status = "Enabled"

    expiration {
      days = each.value.lifecycle_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# CloudFront logging requires ACL-based access — enable BucketOwnerPreferred for logs bucket only
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.buckets["logs"].id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "logs" {
  bucket     = aws_s3_bucket.buckets["logs"].id
  acl        = "log-delivery-write"
  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

