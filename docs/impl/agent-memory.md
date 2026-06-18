# Agent Memory — 조회 흐름 및 사용 방법

## 개요

AgentOps는 **단일 DynamoDB 테이블** (`aigo-AgentMemory`)을 통해 AI Agent가 과거 분석 결과를 장기 기억으로 저장하고, 새 분석 시 참조할 수 있도록 한다.  
메모리는 Bedrock AgentCore의 세션 메모리(단기)와 별개로, **영구 구조화 메모리**다.

---

## 메모리 타입

| 타입 | PK 패턴 | 용도 | TTL |
|------|---------|------|-----|
| `PR_ANALYSIS` | `MEMORY#PR#ORG#{orgId}#REPO#{repoId}` | PR 분석 결과 이력 | 90일 |
| `APPROVAL_FEEDBACK` | `MEMORY#APPROVAL_FEEDBACK#ORG#{orgId}#REPO#{repoId}` | 수동 승인/반려 피드백 | 90일 |
| `INCIDENT` | `MEMORY#INCIDENT#ORG#{org}#SERVICE#{service}` | 인시던트 RCA 이력 | 1년 |

SK(Sort Key)는 항상 **ISO 8601 타임스탬프** (`now`)로 저장되어 최신순 정렬이 가능.

---

## DynamoDB 스키마

```
PK (String)                                          SK (String, ISO 8601)
──────────────────────────────────────────────────   ─────────────────────
MEMORY#PR#ORG#{orgId}#REPO#{repoId}                  2026-06-16T06:11:18Z
MEMORY#APPROVAL_FEEDBACK#ORG#{orgId}#REPO#{repoId}   2026-06-16T07:27:01Z
MEMORY#INCIDENT#ORG#{orgId}#SERVICE#{service}         2026-06-17T03:00:00Z
```

### GSI 구성

| GSI | Hash Key | Sort Key | 용도 |
|-----|----------|----------|------|
| `GSI1-repo-time-index` | `GSI1PK = ORG#{orgId}#REPO#{repoId}` | `GSI1SK = timestamp` | 레포별 최신 분석 이력 조회 |
| `GSI2-author-time-index` | `GSI2PK = ORG#{orgId}#AUTHOR#{authorLogin}` | `GSI2SK = timestamp` | 개발자별 PR 이력 조회 |

---

## 메모리 저장 시점 (Write)

### 1. PR 분석 완료 후 — `save_pr_analysis_memory`

오케스트레이터 Step 12에서 호출. PR 리스크 분석 결과 전체를 메모리에 저장.

```python
save_pr_analysis_memory(
    org_id="{orgId}",
    repo_id="{repoId}",
    repo_full_name="owner/repo",
    pr_number=42,
    author_login="dev-name",
    risk_score=87,
    risk_level="CRITICAL",
    findings_summary={"CRITICAL": 2, "HIGH": 3, "MEDIUM": 2, "LOW": 1},
    key_findings=["Missing auth check in delete_user", "No null validation"],
    merge_recommendation="BLOCK",
)
```

저장되는 필드:
```json
{
  "PK": "MEMORY#PR#ORG#MQG1U5HYVZASM6B#REPO#MQG7P1M4VPSP2IA",
  "SK": "2026-06-17T06:46:00.000Z",
  "memoryType": "PR_ANALYSIS",
  "orgId": "MQG1U5HYVZASM6B",
  "repoId": "MQG7P1M4VPSP2IA",
  "repoFullName": "hj-3/gympt-app",
  "prNumber": 42,
  "authorLogin": "hj-3",
  "riskScore": 87,
  "riskLevel": "CRITICAL",
  "findingsSummary": {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 2, "LOW": 1},
  "keyFindings": ["Missing auth check in delete_user", "..."],
  "mergeRecommendation": "BLOCK",
  "GSI1PK": "ORG#MQG1U5HYVZASM6B#REPO#MQG7P1M4VPSP2IA",
  "GSI1SK": "2026-06-17T06:46:00.000Z",
  "GSI2PK": "ORG#MQG1U5HYVZASM6B#AUTHOR#hj-3",
  "GSI2SK": "2026-06-17T06:46:00.000Z",
  "ttl": 1789737960  // Unix timestamp 90일 후
}
```

### 2. 인시던트 해결 후 — `save_incident_memory`

Incident Agent가 RCA 완료 후 호출.

```python
save_incident_memory(
    org_id="{orgId}",
    incident_id="INC-001",
    service="prod-api",
    root_cause="PR #27 webhook validation 누락",
    resolution="즉시 롤백 후 hotfix 배포",
    affected_services=["prod-api", "notification-worker"],
    prevention="PR 분석 시 인증 검증 체크 강화",
    duration_minutes=45,
)
```

---

## 메모리 조회 시점 (Read)

### 1. PR 분석 시작 전 — `get_repo_memory`

오케스트레이터 Step 0에서 호출. 같은 레포의 최근 5개 PR 분석 이력을 가져와 프롬프트에 주입.

```python
get_repo_memory(org_id="{orgId}", repo_id="{repoId}", limit=5)
```

**조회 경로**: `GSI1-repo-time-index`, `ScanIndexForward=False` (최신순)

**반환 예시**:
```json
[
  {
    "prNumber": 34,
    "riskLevel": "MEDIUM",
    "riskScore": 35,
    "keyFindings": ["N+1 쿼리 패턴 발견"],
    "mergeRecommendation": "REQUEST_CHANGES"
  },
  {
    "prNumber": 33,
    "riskLevel": "LOW",
    "riskScore": 12,
    "mergeRecommendation": "APPROVE"
  }
]
```

**활용**: 오케스트레이터가 "이 레포에서 반복되는 패턴(N+1, 인증 누락 등)"을 파악하고 현재 PR 분석 시 가중치를 높임.

### 2. 개발자 이력 조회 — `get_developer_memory`

PR 작성자의 과거 PR 패턴을 분석. (현재 오케스트레이터 Step 0에서 선택적 호출)

```python
get_developer_memory(org_id="{orgId}", author_login="hj-3", limit=10)
```

**조회 경로**: `GSI2-author-time-index`, `ScanIndexForward=False`

**활용**: 특정 개발자가 반복적으로 보안 이슈를 남기는 패턴이 있으면 Security 페르소나 가중치 증가.

### 3. 인시던트 조사 시작 전 — `get_incident_memory`

Incident Agent 실행 Step 0에서 호출.

```python
get_incident_memory(org_id="{orgId}", service="prod-api", limit=5)
```

**조회 경로**: `GSI1-repo-time-index` (PK = `ORG#{orgId}#SERVICE#{service}`)

---

## 오케스트레이터 프롬프트 내 메모리 사용 흐름

```
PR 분석 요청 수신
    │
    ▼
Step 0: get_repo_memory(orgId, repoId)
  → 최근 5개 PR 이력 조회
  → "이 레포에서 반복되는 이슈: MEDIUM 리스크 2건, N+1 패턴 1건..."
    │
    ▼
Persona 1 (Code): search_coding_standards(query) → KB 조회
  → 레포 메모리 컨텍스트 + KB 표준 + PR diff 통합 분석
    │
    ▼
    ... (각 페르소나 실행)
    │
    ▼
Step 11: save_report → Step 12: save_pr_analysis_memory
  → 현재 분석 결과를 메모리에 저장 (다음 PR 분석 시 참조됨)
```

---

## 메모리 주요 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `riskScore` | Number | 0-100 정량적 리스크 스코어 |
| `keyFindings` | List\<String\> | 핵심 발견 3-5개 (요약 문장) |
| `findingsSummary` | Map | severity별 건수 (CRITICAL/HIGH/MEDIUM/LOW) |
| `mergeRecommendation` | String | APPROVE / REQUEST_CHANGES / BLOCK |
| `ttl` | Number | DynamoDB TTL — PR_ANALYSIS: 90일, INCIDENT: 1년 |

---

## 현재 메모리 데이터 현황 (2026-06-17)

| 타입 | 건수 | 내용 |
|------|------|------|
| `PR_ANALYSIS` | 2 | hj-3/gympt-app PR #33, #34 |
| `APPROVAL_FEEDBACK` | 1 | PR #36 승인 피드백 |
| `INCIDENT` | 0 | 아직 인시던트 발생 없음 |

---

## 메모리가 분석 품질에 미치는 영향

메모리가 축적될수록 오케스트레이터는:

1. **반복 패턴 조기 감지**: 3번 이상 같은 카테고리 발견 → 해당 검사 강화
2. **개발자 맞춤 피드백**: 과거 패턴 기반 구체적 수정 방향 제시
3. **레포 리스크 기준선 수립**: 레포 평균 리스크 대비 현재 PR 상대 평가
4. **인시던트 연관 분석**: 과거 인시던트 원인과 현재 PR 패턴 연계

> **TTL 전략**: PR 메모리 90일 → 최근 개발 패턴만 반영, 오래된 코드 습관 노이즈 방지  
> **인시던트 메모리 1년** → 계절성 장애, 배포 주기별 패턴 감지용
