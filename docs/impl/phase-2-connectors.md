# Phase 2: Connectors

## 개요
GitHub, Slack, Dashboard, AWS Event — 4개 Lambda 진입점 구현. 모두 외부 이벤트를 받아 SQS로 라우팅합니다.

## 구현 내용

### connectors/github (GitHub Webhook Handler)
**파일:** `src/validator.ts`, `src/handler.ts`, `src/index.ts`

**Flow:**
1. X-Hub-Signature-256 HMAC-SHA256 검증 (timingSafeEqual)
2. ping/PR 이외 이벤트는 204 반환
3. draft PR 무시
4. Repositories 테이블에서 orgId/repoId 조회
5. idempotencyKey = `${repoId}#PR#${prNumber}#${commitSha}` 중복 방지
6. AnalysisJobs 테이블에 생성 (ConditionExpression으로 race condition 방지)
7. SQS analysis-queue에 publish (messageGroupId=orgId#repoId)
8. 200 즉시 반환 (GitHub 10초 타임아웃 이내)

**보안:** HMAC-SHA256 timing-safe 비교, replay attack 없음

### connectors/slack (Slack Slash Command Handler)
**파일:** `src/validator.ts`, `src/handler.ts`, `src/index.ts`

**Flow:**
1. X-Slack-Signature HMAC-SHA256 + 5분 timestamp replay 방지
2. URL-encoded form body 파싱
3. /approve, /reject, /investigate 명령 지원
4. SQS command-queue에 publish
5. 200 즉시 반환 (Slack 3초 타임아웃 이내)

### connectors/aws-event (CloudWatch Alarm → Incident)
**파일:** `src/index.ts`

**Flow:**
1. EventBridge에서 CloudWatch Alarm State Change 수신
2. ALARM 상태 전환만 처리
3. Incidents 테이블에 레코드 생성
4. SQS incident-queue에 publish

### connectors/dashboard-cmd (Dashboard API Commands)
**파일:** `src/index.ts`

**Hono 라우터:**
- `POST /reports/{reportId}/approve` → Approvals 생성 + Reports 업데이트 + command-queue
- `POST /reports/{reportId}/reject` → Approvals 생성 + Reports 업데이트
- `POST /fix` → FixRequests 생성 + fix-queue publish

**인증:** Cognito JWT claims에서 sub, custom:orgId 추출

## 공통 패턴
- 모든 Lambda: SQSBatchResponse (Partial Batch Response) 패턴
- 모든 secrets: Secrets Manager에서 실시간 조회
- 모든 로깅: @aigo/logger (Powertools) + requestId context
- 빌드: esbuild bundle (external: @aws-sdk/*)
