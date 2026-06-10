# Phase 3: Workers

## 개요
Lightweight Worker (TypeScript Lambda)와 Heavy Worker (Python ECS Fargate) 구현.

## workers/lightweight (TypeScript Lambda)

### 역할
SQS analysis-queue를 소비하여 PR diff를 가져오고 AgentCore Orchestrator를 호출합니다.

### 파일 구조
```
src/
  index.ts          — SQS handler, partial batch response
  handler.ts        — 단일 레코드 처리 로직
  diff-fetcher.ts   — GitHub API로 PR diff 조회 + S3 저장
  github-auth.ts    — GitHub App JWT → Installation Token
  agentcore-client.ts — Bedrock AgentCore InvokeAgent
```

### Flow
1. SQS record 수신
2. AnalysisJob을 IN_PROGRESS로 업데이트 (ConditionExpression: status=PENDING)
3. Repositories 테이블에서 repoFullName 조회
4. GitHub App Installation Token 발급 (JWT → /app/installations/{id}/access_tokens)
5. Octokit으로 PR diff, files, commits 조회
6. diff를 S3 diffs 버킷에 저장
7. Bedrock AgentCore InvokeAgent 호출 (Orchestrator)
8. 응답을 S3 agent-outputs 버킷에 저장
9. AnalysisJob에 agentSessionId 업데이트

### 에러 처리
- SQSBatchResponse로 개별 실패 레코드만 재시도
- ConditionalCheckFailedException = 중복 처리 방지

## workers/heavy (Python ECS Fargate)

### 역할
Fix Agent가 생성한 patch를 실제 레포에 적용하여 Fix PR을 만듭니다.

### 파일 구조
```
src/
  main.py           — ECS 진입점, structlog 설정
  handler.py        — Fix 요청 처리 main logic
  repo_cloner.py    — GitPython shallow clone
  patch_applier.py  — git apply + commit
  github_client.py  — PyGitHub, branch 생성, PR 생성
  config.py         — Pydantic frozen config
Dockerfile          — python:3.12-slim + git + patch
```

### Flow
1. SQS fix-queue Long Polling (WaitTimeSeconds=20, VisibilityTimeout=900)
2. FixRequest 조회 (patchS3Key 확인)
3. S3에서 patch 내용 다운로드
4. GitHub App Installation Token 발급
5. 레포 shallow clone (depth=50)
6. `git apply --check` dry-run 후 실제 적용
7. commit (AgentOps Bot 이름)
8. fix branch push (`aigo/fix-{fixId[:8]}`)
9. GitHub PR 생성 (draft=false)
10. FixRequest COMPLETED 업데이트

### 보안 제약
- terraform apply, kubectl, aws cli 절대 실행 안 함
- Patch만 생성하고 인간 리뷰 필수
- 레포 클론은 /tmp/repos에 격리, 완료 후 삭제

## workers/notification (TypeScript Lambda)

### 역할
분석 완료·고위험·Fix 준비·승인 필요 등 7종 이벤트를 SQS에서 소비하여
Slack Block Kit 메시지와 GitHub PR 댓글을 발송한다.

### 파일 구조
```
workers/notification/
  package.json        — @aigo/notification-worker
  tsconfig.json       — tsconfig.base.json extends
  src/
    index.ts          — SQS handler (SQSBatchResponse 부분 실패)
    handler.ts        — 단일 레코드 디스패치 (Slack + GitHub 분기)
    slack.ts          — Slack Web API chat.postMessage + Block Kit 빌더
    github.ts         — GitHub App JWT 생성 + PR 코멘트 포스팅
```

### 알림 유형 7종

| 타입 | Slack | GitHub PR 코멘트 |
|------|-------|-----------------|
| `ANALYSIS_COMPLETE` | O | O |
| `HIGH_RISK_DETECTED` | O | O |
| `FIX_READY` | O | O |
| `FIX_APPLIED` | O | O |
| `APPROVAL_NEEDED` | O | O |
| `INCIDENT_DETECTED` | O | — |
| `INCIDENT_RESOLVED` | O | — |

### 배치 실패 처리
`SQSBatchResponse`를 반환하여 실패한 레코드만 큐로 복귀.
`Promise.allSettled`로 한 레코드 실패가 전체 배치 실패로 이어지지 않도록 한다.

### Slack Block Kit 구조
`buildBlocks(type, payload)` → header/divider/fields/linkButton 섹션 조합.  
`riskBadge()`: CRITICAL=`:red_circle:`, HIGH=`:large_orange_circle:`, MEDIUM=`:large_yellow_circle:`, 기본=`:large_green_circle:`

### GitHub App 인증 (node:crypto)
외부 라이브러리(jsonwebtoken, @octokit/auth-app) 없이 Node.js 내장 `node:crypto`의
`createSign('RSA-SHA256')`으로 RS256 JWT를 서명하여 번들 크기와 공급망 위험을 최소화한다.

```
privateKey(PEM) → createSign → base64url → JWT
JWT → POST /app/installations/{id}/access_tokens → Installation Token
```

### 환경변수 / 시크릿

| 항목 | 주입 방법 |
|------|----------|
| `SLACK_SECRET_ARN` | Lambda 환경변수 → `getSecret()` |
| `GITHUB_SECRET_ARN` | Lambda 환경변수 → `getSecretJson<GithubAppCredentials>()` |

Slack Bot Token과 GitHub App 자격증명(appId, privateKey, installationId)은
모두 Secrets Manager에서 런타임에 조회한다. 코드·환경변수에 직접 저장 금지.
