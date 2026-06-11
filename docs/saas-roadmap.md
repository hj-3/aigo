# SaaS 전환 로드맵

> 현재 단일 조직(single-tenant) 배포를 완전한 멀티테넌트 SaaS 서비스로 전환하기 위한
> 변경 범위 분석과 구현 계획.
>
> **핵심 결론**: 데이터 모델과 핵심 라우팅 로직이 이미 `orgId` 기반으로 설계되어 있어
> 인프라·스키마 변경은 거의 없다. 대부분의 작업은 **온보딩 플로우, 청구, 자격증명 관리**
> 세 영역에 집중된다.

---

## 1. 이미 멀티테넌트 준비 완료된 항목

변경 불필요. 그대로 SaaS에서 동작한다.

| 항목 | 현황 | 근거 |
|------|------|------|
| DynamoDB PK 설계 | ✅ | 모든 테이블 PK = `ORG#{orgId}`, GSI = `ORG#{orgId}` |
| S3 키 구조 | ✅ | `{type}/{orgId}/{...}` 패턴 전체 적용 |
| Organizations 테이블 | ✅ | `plan: FREE \| PRO \| ENTERPRISE` 컬럼 포함 |
| UsageRecords 테이블 | ✅ | `USAGE#{orgId}#{yearMonth}` PK, 사용량 집계 구조 |
| 모든 도메인 타입 | ✅ | `packages/types`의 모든 DynamoDB 타입에 `orgId: OrgId` 포함 |
| GitHub 웹훅 라우팅 | ✅ | `Repositories` 테이블의 `providerRepoId → orgId` 매핑으로 멀티테넌트 라우팅 이미 구현 |
| JWT orgId 추출 | ✅ | `custom:orgId` claim → `dashboard-cmd` connector 에서 이미 사용 |
| API Gateway JWT 인증 | ✅ | Cognito JWT 검증 authorizer 적용 (웹훅 경로 제외) |
| Cognito RBAC 그룹 | ✅ | `OWNER / ADMIN / REVIEWER / VIEWER` 4단계 |
| AgentCore Memory 키 | ✅ | `actorId = orgId` 기반 격리 |

---

## 2. 변경 범위별 분류

### 2-A. 소규모 수정 (코드 변경 1~2곳)

#### AWS Event Connector — `DEFAULT_ORG_ID` 제거
**현재**: `process.env['DEFAULT_ORG_ID']`로 하드코딩
**변경**: AWS 리소스 태그 기반 orgId 조회

```typescript
// connectors/aws-event/src/handler.ts

// AS-IS
const orgId = process.env['DEFAULT_ORG_ID'];

// TO-BE: CloudWatch Alarm ARN 또는 리소스 태그에서 orgId 조회
async function resolveOrgFromAlarm(alarmArn: string): Promise<string | null> {
  // 방법 1: Alarm 이름 규칙 — aigo-{orgId}-{serviceName}-error-rate
  const match = alarmArn.match(/aigo-([^-]+)-/);
  if (match) return match[1];

  // 방법 2: CloudWatch Alarm 태그 조회
  const tags = await cloudwatchClient.listTagsForResource({ ResourceARN: alarmArn });
  return tags.Tags?.find(t => t.Key === 'OrgId')?.Value ?? null;
}
```

**대안**: Integrations 테이블에 `AWS_ACCOUNT#{accountId}` → orgId 매핑 저장 후 조회.

---

#### Cognito — 자체 가입 허용
**현재**: `allow_admin_create_user_only = true` (관리자만 사용자 생성 가능)
**변경**: 자체 가입 허용 후 org 생성 플로우로 연결

```hcl
# modules/cognito/main.tf
admin_create_user_config {
  allow_admin_create_user_only = false   # true → false
}
```

> **주의**: 가입 후 orgId가 아직 없는 상태. Lambda Trigger(Post-Confirmation)로
> 빈 org 생성 + `custom:orgId` 설정 처리 필요.

---

### 2-B. 중간 규모 수정 (신규 모듈 또는 테이블 항목 추가)

#### GitHub App — 멀티 Installation 지원
**현재**: 단일 `GITHUB_SECRET_ARN` 환경변수 (하나의 GitHub App installation 가정)

**GitHub App 멀티테넌트 원리**:
- 하나의 GitHub App → 웹훅 시그니처 검증용 secret 하나 (전역, 현재와 동일)
- 여러 Installation → 각각 `installationId`, `installationAccessToken` 보관

**변경 포인트**: `Integrations` 테이블에 per-org 자격증명 저장

```typescript
// DynamoDB Integrations 테이블 항목 구조
{
  PK: `ORG#${orgId}`,
  SK: `INTEGRATION#GITHUB`,
  type: 'GITHUB',
  installationId: '12345678',
  // 토큰은 Secrets Manager에 저장, 여기엔 ARN만
  secretArn: `arn:aws:secretsmanager:...:aigo/orgs/${orgId}/github`,
  status: 'ACTIVE',
}
```

**웹훅 핸들러 변경**: 현재 `Repositories` 테이블로 orgId 조회하는 로직은 그대로 유지.
추가로 해당 orgId의 `Integrations` 테이블에서 installationId 조회.

```typescript
// connectors/github/src/handler.ts — 변경 최소화
// ① 웹훅 시그니처 검증: 기존과 동일 (전역 시크릿)
// ② orgId 조회: 기존과 동일 (Repositories 테이블)
// ③ Installation 토큰: Integrations 테이블 조회 추가
const integration = await ddbGet({ PK: `ORG#${orgId}`, SK: 'INTEGRATION#GITHUB' });
const ghToken = await getSecret(integration.secretArn); // per-org 토큰
```

---

#### Slack App — 멀티 Workspace 지원
**현재**: 단일 `SLACK_SECRET_ARN` 환경변수 (하나의 Slack workspace 가정)

**Slack App 멀티테넌트 원리**:
- Signing Secret: 하나 (전역, 앱 단위)
- Bot Token: Workspace마다 다름 → OAuth 설치 플로우로 획득

```typescript
// DynamoDB Integrations 테이블 항목 구조
{
  PK: `ORG#${orgId}`,
  SK: `INTEGRATION#SLACK`,
  type: 'SLACK',
  teamId: 'T01ABC123',          // Slack team_id (요청에 포함)
  teamName: 'Acme Corp',
  secretArn: `arn:aws:secretsmanager:...:aigo/orgs/${orgId}/slack`,
  status: 'ACTIVE',
}

// GSI1: teamId로 orgId 역조회 (슬래시 커맨드 수신 시)
// GSI1PK: `SLACK_TEAM#${teamId}` → orgId 조회
```

**커맨드 핸들러 변경**: 요청의 `team_id`로 Integrations 테이블 조회 → orgId 해석.

---

#### API Lambda — orgId 강제 검증 미들웨어
**현재**: JWT에서 `custom:orgId` 추출은 dashboard-cmd에만 있음
**변경**: `packages/aws-clients` 또는 별도 미들웨어에서 공통 처리

```typescript
// packages/aws-clients/src/auth.ts (신규)
export function extractOrgId(event: APIGatewayProxyEventV2): string {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const orgId = claims?.['custom:orgId'];
  if (!orgId) throw new AuthError('orgId_missing_in_token');
  return orgId;
}

// 모든 API Lambda에서 첫 라인에 추가
const orgId = extractOrgId(event);
// 이후 모든 DynamoDB 조회에 orgId 포함 → 타 조직 데이터 접근 불가
```

---

### 2-C. 신규 기능 (없음에서 새로 만들어야 하는 것)

#### C-1. 온보딩 플로우

가장 많은 작업이 필요한 영역. 사용자 가입 → org 생성 → 연동 설정까지의 전체 흐름.

```
[1] 이메일 가입 (Cognito self-registration)
    └─ Post-Confirmation Lambda Trigger
       ├─ Organizations 테이블에 신규 Org 생성 (plan: FREE)
       ├─ Users 테이블에 OWNER 역할로 등록
       └─ Cognito user attribute custom:orgId 업데이트

[2] 온보딩 위자드 (Dashboard)
    ├─ Step 1: GitHub App 설치 (OAuth redirect → installationId 저장)
    ├─ Step 2: Slack 앱 설치 (OAuth redirect → teamId + botToken 저장)
    ├─ Step 3: 레포지토리 선택 및 자동 분석 활성화
    └─ Step 4: 팀원 초대 이메일 발송

[3] 초대 흐름
    ├─ OWNER가 이메일 입력 → Cognito admin-create-user (임시 비밀번호)
    ├─ 초대 메일 수신 → 비밀번호 변경 → custom:orgId 자동 설정
    └─ OWNER/ADMIN만 초대 가능
```

**필요한 백엔드 Lambda**:
- `onboarding-api` — org 생성, 연동 등록, 초대 관리
- `github-oauth-callback` — GitHub App 설치 콜백 처리
- `slack-oauth-callback` — Slack 설치 콜백 처리

**Cognito Lambda Trigger** (Terraform):
```hcl
# modules/cognito/main.tf
resource "aws_cognito_user_pool" "main" {
  lambda_config {
    post_confirmation = aws_lambda_function.post_confirmation.arn
  }
}
```

---

#### C-2. 청구 (Billing)

UsageRecords 테이블이 이미 존재. 집계 → Stripe 연동만 추가하면 된다.

```
UsageRecords 테이블 항목:
  PK: USAGE#{orgId}#{yearMonth}   예: USAGE#01HN5X#2026-06
  analysisJobsCount  Number
  agentRunsCount     Number
  fixRequestsCount   Number
  computeMinutes     Number
  updatedAt          String
```

**필요한 구성**:

| 컴포넌트 | 설명 |
|----------|------|
| `usage-aggregator` Lambda | EventBridge Scheduler로 매일 실행, UsageRecords 집계 |
| `billing-webhook` Lambda | Stripe 이벤트 수신 (결제 성공/실패/구독 변경) |
| Stripe 연동 | Subscription → Plan 동기화, Organizations.plan 업데이트 |
| 사용량 제한 미들웨어 | FREE 플랜 월 분석 100건 등 제한 체크 |
| Dashboard 청구 페이지 | 현재 사용량, 청구 내역, 플랜 업그레이드 |

**플랜별 제한 (예시)**:

| 기능 | FREE | PRO | ENTERPRISE |
|------|------|-----|------------|
| 분석 잡/월 | 50 | 500 | 무제한 |
| 레포지토리 | 3 | 20 | 무제한 |
| Fix Request/월 | 5 | 50 | 무제한 |
| AgentCore Memory | 없음 | 30일 | 무제한 |
| 팀원 수 | 3 | 20 | 무제한 |

---

#### C-3. 관리자 포털 (플랫폼 운영팀용)

고객사 관리·지원용 내부 도구. 초기에는 AWS 콘솔 직접 접근으로 대체 가능.

- 조직 목록 / 플랜 변경 / 사용량 조회
- 지원 접근 (특정 org 데이터 조회)
- 이상 탐지 알람 (비정상 사용량, 오류율 급증)

---

## 3. 전환 우선순위 및 순서

```
Phase S-1: 기반 (1~2주)
  ① Cognito allow_admin_create_user_only = false
  ② Post-Confirmation Lambda Trigger → Org 자동 생성
  ③ orgId 강제 검증 미들웨어 (packages/aws-clients)
  ④ AWS event connector DEFAULT_ORG_ID 제거 → 태그 기반 조회

Phase S-2: 연동 (2~3주)
  ⑤ GitHub OAuth 콜백 Lambda + Integrations 테이블 저장
  ⑥ Slack OAuth 콜백 Lambda + teamId 기반 orgId 조회
  ⑦ 온보딩 위자드 Dashboard 페이지 (4단계)
  ⑧ 팀원 초대 흐름

Phase S-3: 수익화 (3~4주)
  ⑨ Stripe Subscription 연동
  ⑩ usage-aggregator Lambda (EventBridge Scheduler)
  ⑪ 플랜별 사용량 제한 미들웨어
  ⑫ Dashboard 청구 페이지

Phase S-4: 운영 성숙 (지속)
  ⑬ 플랜별 Bedrock KB 격리 (공유 KB vs 조직 전용 KB)
  ⑭ 관리자 포털
  ⑮ 자동화된 오프보딩 (데이터 삭제 / 내보내기)
```

---

## 4. 인프라 변경 범위

| 레이어 | 변경 필요 | 내용 |
|--------|-----------|------|
| DynamoDB | ❌ 없음 | 스키마 이미 완비 |
| S3 | ❌ 없음 | 키 구조 이미 완비 |
| Cognito | 🔸 소규모 | `allow_admin_create_user_only = false`, Post-Confirmation Lambda Trigger 추가 |
| API Gateway | 🔸 소규모 | OAuth 콜백 라우트 추가 (`/oauth/github/callback`, `/oauth/slack/callback`) |
| Lambda | 🔸 중간 | `onboarding-api`, `github-oauth-callback`, `slack-oauth-callback`, `usage-aggregator`, `billing-webhook` 신규 |
| Secrets Manager | 🔸 소규모 | per-org 시크릿 경로 패턴 추가: `aigo/orgs/{orgId}/github`, `aigo/orgs/{orgId}/slack` |
| EventBridge | 🔸 소규모 | `usage-aggregator` Scheduler 룰 추가 |
| KMS | ❌ 없음 | 기존 S3·DynamoDB·Lambda 키로 충분 |
| VPC / 네트워크 | ❌ 없음 | Stripe NAT 이미 설계에 포함 |
| CloudFront | ❌ 없음 | SPA 라우팅 이미 처리 |

**신규 Terraform 모듈**: `billing` (Stripe 웹훅 엔드포인트, usage-aggregator, 알람)

---

## 5. 데이터 격리 검증 체크리스트

SaaS 전환 전 반드시 검증해야 할 항목.

- [ ] 모든 DynamoDB 쿼리가 PK에 `ORG#${orgId}` 포함 여부
- [ ] JWT 없는 요청이 API Gateway에서 401 반환 여부
- [ ] `custom:orgId`가 없는 JWT로 dashboard-api 접근 시 차단 여부
- [ ] orgId A의 사용자가 orgId B의 리포트를 직접 URL로 접근 불가 여부
- [ ] S3 Presigned URL 생성 시 orgId 경로 포함 여부
- [ ] Bedrock AgentCore Memory가 `actorId = orgId`로 격리 여부
- [ ] GitHub 웹훅이 미등록 레포에서 수신 시 즉시 무시 여부 (현재 구현됨 ✅)
- [ ] Slack 커맨드가 등록되지 않은 team_id에서 수신 시 무시 여부

---

## 6. 현재 코드에서 SaaS 전환 시 주의할 지점

### GitHub connector `handler.ts`

```typescript
// 현재: GITHUB_SECRET_ARN 단일 환경변수 → 전역 시크릿 (유지 가능)
// 이유: GitHub App 웹훅 시그니처는 앱 단위 (전역), 설치별 액세스 토큰은 Integrations에서 조회
// 변경 없이 멀티테넌트 지원 가능. 단, 이후 GitHub API 호출 시 per-org token 필요.
```

### AWS Event connector `index.ts`

```typescript
// 제거 대상: const orgId = process.env['DEFAULT_ORG_ID'];
// 대체 방법 1 (단순): EventBridge rule에 orgId를 event detail에 포함
// 대체 방법 2 (정확): CloudWatch Alarm 태그 → orgId 조회
// 대체 방법 3 (확장): Integrations 테이블에 AWS Account # → orgId 매핑
```

### Bedrock Knowledge Base

```
현재: 단일 KB (aigo-kb, ID: BTLXQGMG9F) — AWS 모범 사례 + 공통 정책 문서
SaaS 전환 시:
  - 공유 KB: AWS 모범 사례 문서 → 모든 조직이 공유 (현재 구조 유지)
  - 조직 전용 KB: 조직 내부 정책/규정 문서 → PRO 이상에서 별도 KB 생성
  - 구현: Organizations 테이블에 kbId 컬럼 추가, 없으면 공유 KB 사용
```

---

## 7. 요약

| 범주 | 작업량 | 핵심 내용 |
|------|--------|-----------|
| 데이터 모델 | **없음** | DynamoDB, S3 이미 완전한 멀티테넌트 구조 |
| 라우팅·격리 | **최소** | GitHub connector는 이미 orgId 기반 라우팅 |
| 인증·권한 | **소규모** | Cognito 자체가입 허용 + orgId 미들웨어 표준화 |
| 연동 자격증명 | **중간** | Integrations 테이블 패턴 + per-org Secrets Manager |
| 온보딩 | **중간** | 신규 Lambda 3개 + Dashboard 위자드 |
| 청구 | **중간** | Stripe + usage-aggregator + 플랜 제한 |
| 운영 도구 | **선택** | 관리자 포털 (초기에는 콘솔로 대체 가능) |

**전체 공수 추정**: 혼자 작업 기준 6~8주 (Phase S-1~S-3 완료 기준)
