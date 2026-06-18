# Phase 6: Dashboard & Dashboard API

## 개요
React 18 SPA (apps/dashboard)와 Hono Lambda REST API (apps/dashboard-api) 구현.

## apps/dashboard (React SPA)

### 기술 스택
| 라이브러리 | 용도 |
|-----------|------|
| React 18 | UI |
| TanStack Router v1 | 파일 기반 라우팅 |
| TanStack Query v5 | 서버 상태 관리 (30s staleTime) |
| Zustand v5 | 클라이언트 상태 (인증) |
| Tailwind CSS v3 | 스타일링 |
| aws-amplify | Cognito 인증 |
| Vite 6 | 번들러 |

### 파일 구조
```
src/
  main.tsx                    — React 진입점 (Amplify.configure + AuthProvider)
  router.tsx                  — TanStack Router 라우트 정의 (protectedRoute 가드)
  vite-env.d.ts               — ImportMetaEnv 타입 선언 (VITE_* 변수)
  index.css                   — Tailwind + severity badge 클래스
  lib/
    api-client.ts             — fetch 래퍼 (Cognito JWT 자동 첨부)
    query-client.ts           — QueryClient 설정 (retry, staleTime)
    utils.ts                  — cn(), formatDate(), riskLevelBadge()
  store/
    auth.ts                   — Zustand 인증 스토어 (RBAC 계층: OWNER>ADMIN>REVIEWER>VIEWER)
  components/
    AuthProvider.tsx          — Hub 이벤트 기반 인증 상태 동기화
    layout/Layout.tsx         — 사이드바 네비게이션
  pages/
    DashboardPage.tsx         — 통계 + 최근 리포트
    ReportsPage.tsx           — 리포트 목록 테이블
    ReportDetailPage.tsx      — 상세 + 승인/거절/Fix 버튼
    IncidentsPage.tsx         — 인시던트 목록
    IncidentDetailPage.tsx    — 인시던트 상세 + 조사 결과
    RepositoriesPage.tsx      — 리포지토리 카드 그리드
    FixCenterPage.tsx         — Fix 요청 목록 + 상태 필터
    JobDetailPage.tsx         — 분석 Job 상세 + Agent 실행 타임라인
    SettingsPage.tsx          — 조직 설정 (ADMIN 권한 필요)
    LoginPage.tsx             — Cognito Managed Login 리다이렉트
```

### 인증 (Amplify v6 + Cognito Managed Login)

> **변경 이력**: 초기 설계는 Hosted UI(Classic). 이후 Managed Login(v2)으로 전환.  
> `modules/cognito/main.tf`에 `managed_login_version = 2` + `aws_cognito_managed_login_branding` 추가.  
> 비밀번호 최소 길이: 12자 → 8자.  
> Cognito 콜백 URL 경로: `/auth/callback` → `/`(루트).  
> 상세 수정 내역: `docs/impl/terraform-apply-fixes.md` #21, #22.

**초기화 (`main.tsx`)**
`Amplify.configure()`를 React 렌더 전에 호출한다. 설정값은 빌드 타임 환경변수(VITE_*)에서 주입한다.

```
VITE_COGNITO_USER_POOL_ID   — Cognito User Pool ID
VITE_COGNITO_CLIENT_ID      — App Client ID
VITE_COGNITO_DOMAIN         — Managed Login 도메인 (xxx.auth.ap-northeast-2.amazoncognito.com)
VITE_REDIRECT_SIGN_IN       — OAuth 콜백 URL (CloudFront 도메인 루트 /)
VITE_REDIRECT_SIGN_OUT      — 로그아웃 후 리다이렉트 URL
VITE_API_URL                — Dashboard API Base URL
```

OAuth 설정: `scopes: ['email','openid','profile']`, `responseType: 'code'` (Authorization Code Flow).
`allow_admin_create_user_only = false` — Managed Login UI에서 자가 가입 허용.
빌드 타임 주입: CD `deploy-dashboard` 잡에서 `terraform output -raw`로 읽은 값을 `VITE_*` 환경변수로 전달. (`docs/impl/cicd-fixes.md` #24 참조)

**AuthProvider (`components/AuthProvider.tsx`)**
- 마운트 시 `getCurrentUser() + fetchUserAttributes()`로 초기 사용자 조회
- `Hub.listen('auth')` 이벤트 구독:
  - `signedIn` → `resolveUser()` 재조회 후 Zustand 스토어 갱신
  - `signedOut` / `tokenRefresh_failure` → 스토어 null 처리

**LoginPage (`pages/LoginPage.tsx`)**
마운트 즉시 `signInWithRedirect()`를 호출한다. 별도 로그인 폼 없이 Cognito Hosted UI로 리다이렉트.

**라우트 가드 (`router.tsx`)**
`protectedRoute` (TanStack Router layout route)의 `beforeLoad`에서 `getCurrentUser()`를 호출한다.
예외 발생 시 `/login`으로 `redirect()`. `/login`은 `protectedRoute`의 형제 노드로 가드에서 제외된다.

```
rootRoute
  ├── loginRoute (/login)          — 가드 없음, LoginPage 렌더
  └── protectedRoute               — beforeLoad: getCurrentUser()
        ├── dashboardRoute (/)     — Layout > DashboardPage
        ├── reportsRoute (/reports)
        ├── fixCenterRoute (/fix)  — FixCenterPage
        ├── jobsRoute (/jobs)      — 목록 (향후 확장)
        ├── jobDetailRoute (/jobs/$jobId) — JobDetailPage
        └── settingsRoute (/settings) — SettingsPage
```

### FixCenterPage (`pages/FixCenterPage.tsx`)

상태 필터 버튼 6종(PENDING / IN_PROGRESS / PATCH_READY / PR_CREATED / APPLIED / FAILED)으로
`GET /fix?status={status}` 쿼리를 실행한다.

| 컬럼 | 설명 |
|------|------|
| Fix ID | PR URL이 있으면 링크 표시 |
| Report | `/reports/{reportId}` 링크 |
| Status | 색상 Badge |
| 요청자 | `requestedBy` |
| 패치 요약 | `patchSummary` 첫 100자 |
| 생성일시 | `createdAt` |

### JobDetailPage (`pages/JobDetailPage.tsx`)

`useParams({ from: '/jobs/$jobId' })`로 jobId를 추출한다.

**두 개의 TanStack Query:**
1. `GET /jobs/{jobId}` — Job 메타데이터 (브랜치, 커밋 SHA, 작성자, 상태)
2. `GET /jobs/agent-runs?jobId={jobId}` — Agent 실행 목록

Agent 실행 타임라인: agentType, status, 소요 시간(duration), 입력/출력 토큰 수 표시.

### SettingsPage (`pages/SettingsPage.tsx`)

| 항목 | 타입 | 권한 |
|------|------|------|
| PR 자동 분석 (`autoAnalyzeOnPR`) | checkbox | ADMIN |
| 수동 승인 필수 (`approvalRequired`) | checkbox | ADMIN |
| 자동 머지 임계값 (`riskThreshold`) | select (NONE/LOW/MEDIUM/HIGH/CRITICAL) | ADMIN |
| Slack 채널 (`slackChannel`) | text | ADMIN |
| 타임존 (`timezone`) | select | ADMIN |

`useAuthStore((s) => s.hasRole('ADMIN'))`으로 비ADMIN 사용자에게는 편집 UI를 숨긴다.  
`draft` 패턴으로 변경 사항을 추적하고, 변경이 없거나 mutation 진행 중이면 저장 버튼 비활성화.  
저장 API: `PATCH /settings`

**riskThreshold 옵션 의미:**

| 옵션 | 내부 임계값 | 동작 |
|------|-----------|------|
| `NONE` | -1 | 자동 머지 완전 비활성화 |
| `LOW` | 19 | risk_score < 20 일 때만 자동 머지 |
| `MEDIUM` | 39 | risk_score < 40 일 때 자동 머지 |
| `HIGH` | 74 | risk_score < 75 일 때 자동 머지 (기본값) |
| `CRITICAL` | 100 | 모든 PR 자동 머지 |

> `approvalRequired`가 체크된 경우 riskThreshold와 관계없이 자동 머지가 비활성화된다.

### 빌드 최적화
- manualChunks: react, router, query 별도 청크
- HTML은 no-cache, 정적 파일은 max-age=31536000

## apps/dashboard-api (Hono Lambda)

### 라우트
| 메서드 | 경로 | 설명 |
|-------|------|------|
| GET | /dashboard/stats | 대시보드 통계 (병렬 DDB 쿼리) |
| GET | /reports | 조직의 리포트 목록 |
| GET | /reports/{reportId} | 리포트 상세 + findings |
| GET | /incidents | 조직의 인시던트 목록 |
| GET | /incidents/{incidentId} | 인시던트 상세 |
| GET | /repositories | 조직의 리포지토리 목록 |
| GET | /fix | Fix 요청 목록 (`?reportId=` 또는 `?status=` 필터) |
| GET | /fix/{fixId} | Fix 요청 상세 |
| GET | /jobs | 분석 Job 목록 (`?status=` 필터) |
| GET | /jobs/active | PENDING + IN_PROGRESS Job 병합 조회 (대시보드 실시간 뷰) |
| GET | /jobs/agent-runs | 특정 Job의 Agent 실행 목록 (`?jobId=` 필수) |
| GET | /jobs/{jobId} | Job 상세 |
| GET | /reports | 분석 리포트 목록 (DELETED 제외) |
| GET | /reports/{reportId} | 리포트 상세 (findings 포함) |
| DELETE | /reports/{reportId} | 리포트 삭제 (soft-delete, ADMIN 전용) |
| POST | /reports/{reportId}/approve | 승인/거절 결정 기록 + AgentMemory 업데이트 |
| GET | /settings | 조직 설정 조회 |
| PATCH | /settings | 조직 설정 변경 (ADMIN 전용, slackChannel → SSM 동기화) |

### 미들웨어
- `requireAuth()`: Cognito JWT claims 추출 (requestContext.authorizer.jwt.claims)
- `requireRole(minRole)`: RBAC 계층 검증
- CORS: 동적 origin 검증 (ALLOWED_ORIGINS env var)

### 라우트 구현 상세

**`/fix` 라우트 (`routes/fixes.ts`)**
- `?reportId=` → `GSI1-reportId-status-index` 쿼리
- `?status=` → `GSI2-orgStatus-createdAt-index` 쿼리 (`GSI2PK = ORG#{orgId}#{status}`)

**`/jobs` 라우트 (`routes/jobs.ts`)**
- `GET /jobs` → `GSI2PK = ORG#{orgId}#{status}` limit 50
- `GET /jobs/agent-runs` — `/jobs/:jobId`보다 **앞에** 등록. 리터럴 경로가 파라미터 경로에 먹히지 않도록 순서 보장
- Agent runs 조회: `GSI1PK = JOB#{jobId}`

**`/settings` 라우트 (`routes/settings.ts`)**
- `PATCH /settings`: 허용 필드 화이트리스트 적용 (`notificationChannels`, `autoAnalyzeOnPR`, `riskThreshold`, `approvalRequired`, `slackChannel`, `timezone`, `webhookUrls`)
- `ConditionExpression: 'attribute_exists(PK)'`로 존재하지 않는 조직 업데이트 방지
- ADMIN 미만 역할 → 403

**API Gateway 라우트 매핑 추가 (`envs/prod/main.tf`)**
```hcl
"GET /fix"                    = module.lambda_dashboard_api.alias_arn
"GET /jobs/active"            = module.lambda_dashboard_api.alias_arn
"GET /jobs/agent-runs"        = module.lambda_dashboard_api.alias_arn
"DELETE /reports/{reportId}"  = module.lambda_dashboard_api.alias_arn
"GET /settings"               = module.lambda_dashboard_api.alias_arn
"PATCH /settings"             = module.lambda_dashboard_api.alias_arn
```

**Reports 삭제 구현 (`routes/reports.ts`)**
- Soft-delete: `approvalStatus = 'DELETED'`, `GSI3SK = DELETED#<now>` 업데이트
- GET 쿼리에 `FilterExpression: 'approvalStatus <> :deleted'` 적용
- ADMIN 역할 필요

**Findings 조회 키 (reports.ts, v41 수정)**

`save_findings`는 아직 reportId가 생성되지 않은 시점에 호출되므로 `GSI1PK = "JOB#{jobId}"`로 저장한다. 따라서 리포트 상세 조회 시 findings를 가져올 때는 `reportId`가 아닌 `jobId`로 쿼리해야 한다.

```typescript
// ❌ 이전 버그 — reportId로 조회 → 항상 빈 결과
GSI1PK = `REPORT#${reportId}`

// ✅ 수정 — report 레코드에서 jobId 추출 후 JOB# prefix로 조회
const jobId = (report as Record<string, string>)['jobId'] ?? '';
GSI1PK = `JOB#${jobId}`
```

**설정과 Slack 연동 (`routes/settings.ts`)**
- `PATCH /settings`에서 `slackChannel` 변경 시 SSM `/aigo/integrations/slack/{orgId}/channel-id`에 자동 저장
- 오케스트레이터가 SSM에서 채널 ID를 읽어 알림 발송

**AgentPipeline 컴포넌트 재설계 (`components/AgentPipeline.tsx`)**
- 기존 fan-out CSS 레이아웃 → 수직 스텝 레이아웃으로 변경
- 4개 에이전트 페르소나 (Code/Infra/Security/Risk)를 3열 그리드로 표시
- compact 모드: 선형 배지 체인으로 대시보드 카드에서 렌더링
- 각 상태 (pending/running/done/failed) 에 색상·점 애니메이션 적용

**Dashboard 활성 작업 뷰 (`pages/DashboardPage.tsx`)**
- `GET /jobs/active` 폴링 (IN_PROGRESS 있으면 3초, 없으면 5초)
- 각 job 카드에 compact AgentPipeline + 에이전트 배지 표시
- 실패 시 errorMessage 빨간 박스 표시

**ddb_tools.py save_report 개선**
- `prContext` (prNumber, prUrl, prTitle, commitSha, authorLogin) DynamoDB 저장 추가
- 오케스트레이터 프롬프트에서 `save_report` 호출 시 PR 정보 전달

### 데이터 격리
- 모든 쿼리에 orgId 필터 적용
- 다른 조직 데이터 접근 불가 (항상 403/404 반환)
