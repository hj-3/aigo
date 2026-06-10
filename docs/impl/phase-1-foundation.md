# Phase 1: Core Platform Foundation

## 개요
프로젝트 루트 스캐폴딩부터 Terraform 인프라 전체, TypeScript/Python 공유 라이브러리까지 기반 구조를 구축했습니다.

## 작업 내용

### 1. Monorepo 루트 설정
| 파일 | 역할 |
|------|------|
| `package.json` | pnpm workspace root, Node 22.x |
| `pnpm-workspace.yaml` | apps/*, connectors/*, workers/lightweight, packages/* |
| `pyproject.toml` | uv workspace, ruff + pyright 설정 |
| `tsconfig.base.json` | strict TypeScript, ES2022, noUncheckedIndexedAccess |
| `.nvmrc` | Node 22 |
| `.python-version` | Python 3.12 |
| `.prettierrc` | singleQuote, trailingComma:all |
| `eslint.config.mjs` | no-explicit-any:error |

### 2. packages/types
- **13개 DynamoDB 테이블 타입**: Organizations, Users, Repositories, Integrations, AnalysisJobs, AgentRuns, Reports, Findings, Approvals, FixRequests, Incidents, AuditLogs, UsageRecords
- **Brand<T, B> 타입**: OrgId, UserId, JobId, RepoId, IncidentId, FixId, ApprovalId, FindingId, ReportId, AgentRunId
- **SQS 이벤트 타입**: AnalysisQueueMessage, FixQueueMessage, IncidentQueueMessage, CommandQueueMessage
- **웹훅 타입**: GitHubPRWebhookPayload, SlackSlashCommandPayload, CloudWatchAlarmEvent

### 3. packages/aws-clients
- `config.ts`: requireEnv()/optionalEnv() 패턴, Config 싱글톤
- `dynamodb.ts`: ddbGet, ddbPut, ddbUpdate, ddbDelete, ddbQuery, ddbQueryAll, ddbTransact
- `s3.ts`: s3GetObject, s3PutObject, s3GetSignedUrl, s3UploadLargeObject
- `sqs.ts`: sqsSendMessage, sqsSendBatch
- `secretsmanager.ts`: 5분 TTL 인메모리 캐시

### 4. packages/logger
- @aws-lambda-powertools/logger 래퍼
- getLogger(service), createContextLogger(context) 제공

### 5. libs/common (Python)
- ulid.py, logger.py (structlog JSON), exceptions.py, time_utils.py

### 6. libs/aws-utils (Python)
- DynamoTable class with get/put/put_if_not_exists/update/delete/query/query_all
- AWSConfig with require()/optional(), @lru_cache singleton

### 7. libs/finding-schema (Python)
- AgentFinding (frozen Pydantic): severity, category, location, confidence(0-1), fixable, fix_suggestion
- AgentReport: compute_risk_level(), compute_merge_recommendation()
- AnalysisInput, FixInput, IncidentInput

### 8. Terraform 모듈 (12개)
| 모듈 | 주요 리소스 |
|------|------------|
| vpc | 3-tier VPC, 3-AZ NAT, 2 Gateway VPCe + 11 Interface VPCe |
| kms | 5 CMK (dynamo/s3/sqs/lambda/cloudwatch), multi_region=true |
| dynamodb | 13 테이블 모두, PITR+PAY_PER_REQUEST+KMS+Global Tables |
| s3 | 10 버킷, audit-logs Object Lock COMPLIANCE mode |
| sqs | 5 FIFO+1 standard, 5 DLQ, maxReceiveCount=3 |
| eventbridge | Custom bus, 90일 archive, schema registry |
| cognito | User Pool, MFA, PKCE client, 4 groups |
| api-gateway | HTTP API, JWT auth, CORS, webhook NONE auth |
| cloudfront | OAC, SPA fallback, security headers |
| lambda | 재사용 가능 모듈, live alias, X-Ray, error rate alarm |
| ecs | ContainerInsights, heavy-worker task def (2vCPU/4GB) |

### 9. Terraform envs/prod
- `backend.tf`: S3 backend + DynamoDB locking
- `variables.tf`: 9 variables
- `main.tf`: 7 Lambda + SQS event source mappings + Secrets Manager

### 10. Terraform global/iam
- GitHub OIDC provider
- 5 IAM roles: github-actions-deploy, lambda-connector, lambda-api, lambda-worker, ecs-task, ecs-execution

## 설계 결정

### No-Hardcoding
- TypeScript: requireEnv()/optionalEnv()
- Python: AWSConfig.require()/optional()
- Terraform: terraform.tfvars (미커밋), Secrets Manager

### 보안
- DynamoDB: PAY_PER_REQUEST + PITR + KMS CMK + 삭제 보호
- S3: Object Lock COMPLIANCE (audit logs), versioning, lifecycle
- SQS: FIFO + DLQ (maxReceiveCount=3) + KMS
- Lambda: X-Ray tracing + CloudWatch error rate alarm + KMS log encryption
- VPC: Gateway/Interface Endpoints (NAT는 외부 SaaS용만)
