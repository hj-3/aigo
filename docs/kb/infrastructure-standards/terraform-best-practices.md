# Terraform Best Practices

## Module Design
- One module per logical unit (network, compute, database, auth)
- Modules must expose all resource ARNs/IDs as outputs
- No hardcoded account IDs, regions, or resource names — use variables
- Use `local.p` or `local.prefix` pattern for resource name prefixes
- `common_tags` local for consistent tagging across all resources

## State Management
- Remote state in S3 with native locking (`use_lockfile = true`, Terraform 1.10+)
- Separate state files per environment (`prod/terraform.tfstate`, `global/iam/terraform.tfstate`)
- Never store sensitive values in state — use `sensitive = true` and Secrets Manager
- State bucket must have versioning, encryption (KMS), and access logging enabled

## Variables and Secrets
- All secrets via AWS Secrets Manager — never hardcode in `.tf` files or state
- Required variables must have no default; optional variables must have sensible defaults
- Use `validation {}` blocks for variables with constrained values (e.g., environment names)

## Resource Lifecycle
- `deletion_protection_enabled = true` on stateful resources: DynamoDB tables, RDS, S3 with critical data
- `prevent_destroy = true` lifecycle rule on production KMS keys
- `create_before_destroy = true` for zero-downtime replacements (Lambda aliases, SG rules)

## IAM Policies
- Prefer AWS managed policies for standard use cases
- Custom managed policies over inline policies (10,240 byte inline limit)
- Least privilege: grant only actions that Terraform refresh/plan/apply actually needs
- Separate policies by service boundary — never one policy for all permissions

## Naming Conventions
- Pattern: `{project}-{resource-type}[-{qualifier}]`
- Examples: `aigo-lambda-github-connector`, `aigo-sqs-analysis`, `aigo-kms-s3`
- DynamoDB tables: PascalCase (`aigo-AnalysisJobs`)
- Lambda functions: `{project}-{name}` (e.g., `aigo-github-connector`)

## Terraform fmt
- Always run `terraform fmt` after editing `.tf` files
- CI enforces `terraform fmt -check` — manual alignment spaces break the check
- HCL alignment uses single spaces, not manual column alignment

## Common Anti-patterns to Flag
- `aws_iam_policy_document` with `"*"` resource + no condition → HIGH risk
- `aws_s3_bucket_public_access_block` with any `false` value → flag
- Multiple `aws_s3_bucket_policy` resources targeting the same bucket → conflict
- `aws_kms_key` without `enable_key_rotation = true` → compliance risk
- Lambda with `timeout = 900` without corresponding SQS `visibility_timeout` alignment
