# PR Risk Scoring Policy

## Risk Score Calculation (0–100)

The overall risk score is a weighted composite of findings from Code, Infra, and Security agents.

| Agent | Weight | Max Contribution |
|-------|--------|-----------------|
| Security Agent | 40% | 40 points |
| Infra Reviewer | 35% | 35 points |
| Code Reviewer | 25% | 25 points |

Each agent returns a severity-weighted finding score. Severity weights:
- CRITICAL: 25 points
- HIGH: 15 points
- MEDIUM: 5 points
- LOW: 1 point

Score per agent = min(sum of finding weights, agent max contribution)

## Risk Levels and Merge Recommendations

| Score | Risk Level | Recommendation | Required Action |
|-------|------------|----------------|-----------------|
| 0–30 | LOW | APPROVE | None |
| 31–55 | MEDIUM | CONDITIONAL | Address HIGH findings before merge |
| 56–75 | HIGH | CONDITIONAL | OWNER/ADMIN approval required |
| 76–100 | CRITICAL | BLOCK | All CRITICAL and HIGH findings must be resolved |

## Automatic Block Conditions (override score)

Any of the following triggers an immediate BLOCK regardless of score:
- Any CRITICAL severity finding from Security Agent
- AWS credentials or secrets detected in diff
- IAM role with `AdministratorAccess` or `Action: "*"` + `Resource: "*"` added
- Removal of security controls (DenyNonTLS, MFA requirement, GuardDuty disable)
- Dependency with CVSS >= 9.0 added
- Direct push to `main` or `production` branch (should not reach review — block at GitHub level)
- Database migration with irreversible data loss (DROP TABLE, DROP COLUMN without backup)

## High-Risk Change Patterns (elevate to HIGH risk)

The following patterns should increase risk score even if individual findings are MEDIUM:
- Changes to authentication or authorization logic
- Changes to webhook signature validation
- New external HTTP calls (SSRF potential)
- New environment variables that accept URLs or file paths
- Changes to IAM policies, trust relationships, or permission boundaries
- Terraform changes affecting production network ACLs or security groups
- Changes to encryption key configurations
- New cron jobs or scheduled tasks modifying data

## Size-Based Risk Adjustment

Large PRs are inherently harder to review and hide issues:
- > 1,000 lines changed: +5 to risk score
- > 3,000 lines changed: +10 to risk score
- > 10 files in sensitive directories (`infra/`, `auth/`, `iam/`): +10 to risk score

## Confidence-Adjusted Scoring

Agent findings include a confidence score (0.0–1.0). Apply confidence adjustment:
- Score × 1.0 if confidence >= 0.8
- Score × 0.7 if confidence 0.5–0.8
- Score × 0.3 if confidence < 0.5 (report as informational, not blocking)

## Contextual Risk Factors

Increase risk score if any apply:
- PR modifies recently incident-related files (within 30 days of an incident) → +10
- PR author has pattern of security findings in last 5 PRs → +5
- Repository has had production incidents in last 14 days → +5
- PR is targeting a hotfix/release branch with shortened review time → +10
