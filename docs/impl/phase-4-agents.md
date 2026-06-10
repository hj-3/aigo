# Phase 4: Strands Agents

## 개요
AWS Bedrock AgentCore에서 실행되는 7개 Strands Python Agent 구현.
모든 에이전트는 Claude Sonnet 4.6 (claude-sonnet-4-6) 모델 사용.

## 에이전트 목록

### 1. Orchestrator Agent
**역할:** PR 분석 조율, 4개 서브에이전트 병렬 호출, 최종 리포트 생성

**도구:**
- subagent_tools.invoke_code_reviewer
- subagent_tools.invoke_infra_reviewer
- subagent_tools.invoke_risk_reviewer
- subagent_tools.invoke_security_agent
- ddb_tools.save_report
- ddb_tools.save_findings
- ddb_tools.update_job_status
- slack_tools.notify_analysis_complete
- github_tools.post_pr_comment
- pr_tools.get_diff_content

**max_parallel_steps=4** — 4개 서브에이전트 동시 실행

### 2. Code Reviewer Agent
**역할:** 코드 품질, 에러 처리, 테스트 커버리지, 성능, 문서화

**도구:** pr_tools, kb_tools, ddb_tools

**분석 영역:**
- 안티패턴, 복잡도 (Cyclomatic > 10)
- 누락된 null 체크, 삼킨 예외
- N+1 쿼리, 메모리 누수
- 공개 API 미문서화

### 3. Infrastructure Reviewer Agent
**역할:** Terraform/CloudFormation/K8s IaC 보안·비용·HA 검토

**도구:** pr_tools, kb_tools, aws_observability_tools, ddb_tools

**분석 영역:**
- S3 public access, SG 0.0.0.0/0
- 암호화 누락 (KMS)
- PITR/Multi-AZ/DLQ 없음
- CloudWatch 무제한 로그 보존

### 4. Risk Reviewer Agent
**역할:** API 브레이킹 체인지, DB 스키마 변경, 배포 위험 평가

**도구:** pr_tools, kb_tools, repo_tools, ddb_tools

**특이사항:** Blast Radius 평가 (affected_services, user_impact, rollback_complexity)

### 5. Security Agent
**역할:** OWASP Top 10, CWE, AWS 보안 취약점 스캔

**도구:** pr_tools, kb_tools, ddb_tools

**커버리지:** SQL Injection, XSS, SSRF, Auth bypass, Hardcoded secrets, Weak crypto

### 6. Incident Agent
**역할:** CloudWatch Alarm 인시던트 자동 조사

**도구:** aws_observability_tools, repo_tools, ddb_tools, slack_tools

**조사 프레임워크:** OODA Loop (Google SRE 방법론)

**제약:** 조사 및 기록만 — 인프라 변경 절대 금지

### 7. Fix Agent
**역할:** Fixable 발견사항에 대한 unified diff patch 생성

**도구:** pr_tools, patch_tools, ddb_tools

**핵심 제약:**
- Patch만 생성 (terraform apply, kubectl 절대 금지)
- 레포 외부 파일 수정 금지
- 변경은 최소화 (해당 발견사항만 수정)

## 공통 설계

### 모델 설정
```python
BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-6-20250514-v1:0",
    region_name=config.aws_region,
    max_tokens=8192,
    temperature=0.0,  # 결정론적 출력
)
```

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
| orchestrator | `sqs_notification_queue_url`, `s3_diffs_bucket` |
| code-reviewer | `s3_diffs_bucket` |
| infra-reviewer | `s3_diffs_bucket` |
| risk-reviewer | `s3_diffs_bucket` |
| security-agent | `s3_diffs_bucket` |
| incident-agent | `s3_incidents_bucket`, `sqs_notification_queue_url` |
| fix-agent | `s3_diffs_bucket`, `s3_patches_bucket` |

**이전 패턴**: 각 에이전트가 `_require(key)` 함수와 공통 3개 필드를 개별 중복 선언  
**현재 패턴**: `require_env()`와 공통 필드는 `BaseAgentConfig` 단일 관리, 에이전트별 고유 필드만 추가

- Pydantic frozen BaseModel로 설정 불변성 보장
- `@lru_cache(maxsize=1)`으로 설정 싱글톤

### 도구 격리
- 에이전트는 Gateway Tools(MCP)를 통해서만 외부 시스템 접근
- GitHub, DynamoDB, S3, Slack API 직접 호출 금지
