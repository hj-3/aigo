# AWS IAM Best Practices

## Least Privilege Principle
- Grant only the minimum permissions required for a task
- Start with zero permissions and add only what is tested and confirmed necessary
- Prefer specific actions (`s3:GetObject`) over wildcards (`s3:*`)
- Use resource-level conditions to restrict scope (e.g., specific bucket ARN)

## Role Design Patterns
- One IAM role per workload type (Lambda function, ECS task, EC2 instance, GitHub Actions)
- Never share roles across workloads with different trust requirements
- Use separate roles for read vs read-write operations when practical
- Cross-account access: use role assumption, never share long-term credentials

## High-Risk IAM Patterns (Always Flag)
- `"Action": "*"` with `"Resource": "*"` — unrestricted admin equivalent
- `iam:PassRole` without `Condition: iam:PassedToService` restriction
- `iam:CreateRole` + `iam:AttachRolePolicy` together — privilege escalation path
- `sts:AssumeRole` with `"Principal": {"AWS": "*"}` — open trust policy
- `"Effect": "Allow"` on `kms:*` without condition — key management exposure
- Lambda function with `AdministratorAccess` managed policy
- Trust policy allowing `ec2.amazonaws.com` on roles with broad data access

## Service Control Policies (SCP)
- Deny `cloudtrail:StopLogging` and `cloudtrail:DeleteTrail` org-wide
- Deny KMS key deletion without MFA (`aws:MultiFactorAuthPresent`)
- Deny IAM user creation — enforce federated access only
- Deny disabling GuardDuty and SecurityHub

## OIDC / Federated Authentication
- GitHub Actions: use OIDC WebIdentity, never store long-term AWS keys in CI secrets
- Condition must restrict `token.actions.githubusercontent.com:sub` to specific repo and branch
- `sts:AssumeRoleWithWebIdentity` scope to specific repository via condition

## Permission Boundaries
- Apply permission boundaries to developer-created roles to prevent privilege escalation
- Boundary policy should allow only services used in the project scope

## Common Findings in IaC Reviews
- Inline policy with `"Resource": "*"` on S3 actions — flag as HIGH
- Missing `Condition` on `sts:AssumeRole` trust policies — flag as MEDIUM
- CloudFormation/CDK stack roles with `AdministratorAccess` — flag as HIGH
- Lambda execution role with `logs:*` on `*` resource — flag as MEDIUM (should scope to specific log group)
- Missing DenyNonTLS (`aws:SecureTransport`) on S3 bucket policies — flag as MEDIUM
