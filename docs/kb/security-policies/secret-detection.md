# Secret Detection Policy

## What Counts as a Secret
Any of the following found in code, config files, or commit history is a HIGH severity finding:

### Credential Patterns
- AWS Access Key: `AKIA[0-9A-Z]{16}` or `ASIA[0-9A-Z]{16}`
- AWS Secret Key: 40-character base64-like string adjacent to "secret" keyword
- GitHub Personal Access Token: `ghp_[a-zA-Z0-9]{36}` or `github_pat_`
- GitHub App Private Key: PEM block `-----BEGIN RSA PRIVATE KEY-----`
- Slack Bot Token: `xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}`
- Slack Signing Secret: 32-character hex string with "signing_secret" label
- Stripe Secret Key: `sk_live_[a-zA-Z0-9]{24}` or `sk_test_`
- OpenAI API Key: `sk-[a-zA-Z0-9]{48}`
- Anthropic API Key: `sk-ant-api[a-zA-Z0-9-]{40,}`
- JWT Secret / HMAC key: high-entropy string assigned to `secret`, `jwt_secret`, `signing_key`
- Database connection strings with credentials embedded: `postgresql://user:password@host`
- Private key files: `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`

### Configuration Anti-patterns
- Hardcoded IP addresses in production config (flag as MEDIUM — may expose internal topology)
- Hardcoded account IDs in IAM policies (flag as LOW if documented, MEDIUM if not)
- `password = "..."` literals in any config file
- `token = "..."` literals in any non-test file

## Severity Classification
| Pattern | Severity | Action |
|---------|----------|--------|
| AWS credentials (AKIA/ASIA) | CRITICAL | Block merge immediately, rotate credentials |
| Active API keys (Stripe live, Anthropic) | CRITICAL | Block merge, revoke key |
| Test/dev keys (sk_test_, localhost) | MEDIUM | Warn, encourage .env pattern |
| High-entropy strings near secret keywords | HIGH | Block merge pending review |
| Encoded secrets (base64) | HIGH | Decode and re-evaluate |
| Internal hostnames/IPs | LOW | Warn only |

## Remediation Guidance
1. Remove the secret from the current commit
2. Rewrite git history (`git filter-branch` or BFG Repo Cleaner) if already merged
3. Immediately rotate the exposed credential in the provider's dashboard
4. Add the pattern to `.gitignore` and a pre-commit hook
5. Move the secret to AWS Secrets Manager; reference by ARN only

## False Positive Reduction
- Ignore matches inside `test/fixtures/` if the value is clearly a placeholder (`FAKE_KEY_FOR_TEST`)
- Ignore base64 strings that decode to non-secret content (e.g., JSON config)
- Skip `.md` and `.txt` files in `docs/` directory for entropy-based detection (high false positive rate)
