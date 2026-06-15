# Phase 4: Strands Agents

## 개요
단일 멀티 페르소나 Strands Agent 기반 설계.  
Orchestrator Lambda가 4개 페르소나(Code/Infra/Security/Risk)를 직접 수행하며, Bedrock AgentCore는 Incident Agent와 Fix Agent에만 사용.

> **변경 이력**: 초기 설계는 4개 별도 Bedrock Agent(Code/Infra/Risk/Security)를 InvokeAgent로 호출하는 방식이었으나,  
> 원래 구상의 "단일 Agent 멀티 페르소나" 아키텍처로 전환 완료 (2026-06-12).

## 에이전트 목록

### 1. Orchestrator Agent (Python Lambda + Strands SDK) ← 멀티 페르소나

**역할:** 단일 Strands Agent가 4개 페르소나를 순차 전환하며 PR 분석 수행 → Risk Score(0-100) 산출 → Report 저장 → 알림

**배포 방식:** `aigo-orchestrator` Python Lambda (runtime: python3.12, timeout: 900s, memory: 3008MB)  
진입점: `agents/orchestrator/lambda_handler.py` → `src/agent.run_analysis()`  
빌드: `scripts/deploy-orchestrator.sh` → CD 파이프라인 자동 배포

**분석 페르소나:**
- **Persona 1 — Code Reviewer**: 버그, 레이스 컨디션, N+1, 하드코딩 시크릿, API 하위 호환성
- **Persona 2 — Infra Reviewer**: IaC(*.tf, *.yaml), IAM 과잉 권한, SG, 암호화 누락, 비용
- **Persona 3 — Security Agent**: OWASP Top 10, CWE, SQL/Command Injection, 인증/인가
- **Persona 4 — Risk Reviewer**: 배포 Blast Radius, DB 스키마 변경, 롤백 복잡도

**허용 Tool:**
- kb_tools: search_coding_standards, search_infrastructure_standards, search_security_standards, search_risk_policies
- ddb_tools: save_report, save_findings, update_job_status
- slack_tools: notify_analysis_complete
- github_tools: post_pr_comment

**IAM 역할:** `aigo-orchestrator-role`
- bedrock:InvokeModel (Claude 3.5 Sonnet v1)
- bedrock:Retrieve (Knowledge Base)
- dynamodb, s3, secretsmanager, kms

### 2. Incident Agent (Bedrock AgentCore — Frontier Agent)

**역할:** CloudWatch Alarm 인시던트 자동 조사, RCA 리포트 생성  
**호출 경로:** Orchestrator → `subagent_tools.invoke_devops_agent`

**도구:** aws_observability_tools, repo_tools, ddb_tools, slack_tools

**조사 프레임워크:** OODA Loop (Google SRE 방법론)

**제약:** 조사 및 기록만 — 인프라 변경 절대 금지

### 3. Fix Agent (Bedrock AgentCore — ECS heavy-worker에서 호출)

**역할:** Fixable Finding에 대한 unified diff patch 생성  
**호출 경로:** heavy-worker ECS container → Bedrock AgentCore Runtime

**도구:** pr_tools, patch_tools, ddb_tools

**핵심 제약:**
- Patch만 생성 (terraform apply, kubectl 절대 금지)
- 레포 외부 파일 수정 금지
- 변경은 최소화 (해당 Finding만 수정)

## 공통 설계

### 모델 설정
```python
BedrockModel(
    model_id="anthropic.claude-3-5-sonnet-20240620-v1:0",  # ap-northeast-2 온디맨드
    region_name=config.aws_region,
    max_tokens=8192,
    temperature=0.0,  # 결정론적 출력
)
```

> **모델 변경 이유 (2026-06-12):** `us.anthropic.claude-sonnet-4-6` 는 APAC 교차 리전 프로파일이
> `ap-northeast-2`에서 Bedrock Agent UpdateAgent에 미지원. `anthropic.claude-3-5-sonnet-20240620-v1:0`
> (v1 온디맨드)으로 전환. AWS Marketplace 사용 사례 승인 완료.

### 환경 변수 패턴 — BaseAgentConfig

`libs/common`의 `BaseAgentConfig`(Pydantic `BaseModel, frozen=True`)를 모든 에이전트가 상속한다.
에이전트별 `config.py`는 에이전트 고유 필드만 추가하면 된다.

```python
# libs/common/src/common/agent_config.py
class BaseAgentConfig(BaseModel, frozen=True):
    aws_region: str           # AWS_REGION (기본: ap-northeast-2)
    model_id: str             # MODEL_ID (기본: claude-sonnet-4-6 cross-region profile)
    dynamodb_table_prefix: str  # DYNAMODB_TABLE_PREFIX (기본: aigo)
    def table(self, name: str) -> str: ...  # "{prefix}-{name}" 반환

def require_env(key: str) -> str:  # 미설정 시 RuntimeError
```

```python
# 각 에이전트 config.py 패턴
from common import BaseAgentConfig, require_env
class AgentConfig(BaseAgentConfig):
    s3_diffs_bucket: str = Field(default_factory=lambda: require_env("S3_DIFFS_BUCKET"))
@lru_cache(maxsize=1)
def get_config() -> AgentConfig: return AgentConfig()
```

| 에이전트 | 추가 필드 |
|---------|----------|
| orchestrator (멀티 페르소나) | `sqs_notification_queue_url`, `s3_diffs_bucket`, `bedrock_kb_id` |
| incident-agent | `s3_incidents_bucket`, `sqs_notification_queue_url` |
| fix-agent | `s3_diffs_bucket`, `s3_patches_bucket` |

> **Phase L 변경**: code-reviewer, infra-reviewer, risk-reviewer, security-agent 4개 Bedrock Agent 제거.  
> Orchestrator Lambda의 단일 Strands Agent가 4개 페르소나를 순차 실행하므로 별도 Agent 불필요.

**이전 패턴**: 각 에이전트가 `_require(key)` 함수와 공통 3개 필드를 개별 중복 선언  
**현재 패턴**: `require_env()`와 공통 필드는 `BaseAgentConfig` 단일 관리, 에이전트별 고유 필드만 추가

- Pydantic frozen BaseModel로 설정 불변성 보장
- `@lru_cache(maxsize=1)`으로 설정 싱글톤

### 도구 격리
- 에이전트는 Gateway Tools(MCP)를 통해서만 외부 시스템 접근
- GitHub, DynamoDB, S3, Slack API 직접 호출 금지
