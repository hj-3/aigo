# AIGO Incident Management — Strands Agent 상세

## CM 에이전트와의 격리 구조

### 근본적 차이: Bedrock Agent vs Pure Strands Lambda

| 항목 | CM (orchestrator) | IM (im-*) |
|------|-------------------|-----------|
| 등록 방식 | `aws_bedrockagent_agent` 리소스 — AWS Bedrock Agents 서비스에 등록 | 등록 없음 — Strands를 Python 라이브러리로만 사용 |
| 호출 방식 | `bedrock-agent-runtime.invoke_agent(agentId, aliasId)` | Step Functions → Lambda 직접 호출 |
| Agent ID | agentId / aliasId 존재, SSM에 저장 | 없음 |
| 세션 관리 | Bedrock이 sessionId 기반으로 관리 | Lambda가 DDB에서 컨텍스트 직접 로드 |
| IAM Role | `aigo-bedrock-agent-role` (CM 공유) | `aigo-im-{name}-role` (IM Lambda별 개별) |

CM 에이전트와 Bedrock Agent ID·IAM Role·SSM 경로를 전혀 공유하지 않으므로 충돌 없음.  
공유하는 유일한 자원은 Bedrock Claude 모델 API 호출이며 stateless이므로 격리 불필요.

### IM 에이전트 실행 구조

```
Step Functions
    └── [동기 호출] aigo-im-poll-investigation (Lambda, 30s)
            - DDB status → INVESTIGATING
            - aigo-im-supervisor 비동기 호출 후 즉시 반환
    ↕ (60s 간격 DDB 폴링)

    [async] aigo-im-supervisor (Lambda, 840s — 병렬 조율자, plain Python)
                ├── [동기 호출] aigo-im-scope-agent (Lambda, 600s)   BedrockModel → Claude
                └── [동기 호출] aigo-im-summary-agent (Lambda, 300s)  BedrockModel → Claude
                완료 후: DDB status → REPORTED

API Gateway → aigo-im-api (Lambda)
    └── [동기 호출] aigo-im-chat-agent (Lambda, 60s)   BedrockModel → Claude
```

### 격리 보장 메커니즘

```python
# IM 에이전트 공통 패턴 — Bedrock Agent 등록 없이 순수 Strands
from strands import Agent
from strands.models import BedrockModel
from botocore.config import Config as BotoConfig

def build_agent(system_prompt: str, tools: list) -> Agent:
    model = BedrockModel(
        model_id=os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6-20250514-v1:0"),
        region_name=os.environ.get("AWS_REGION", "ap-northeast-2"),
        max_tokens=8192,
        temperature=0.0,
        boto_client_config=BotoConfig(
            retries={"max_attempts": 5, "mode": "adaptive"},  # CM과 동시 호출 시 스로틀링 대응
        ),
    )
    return Agent(model=model, system_prompt=system_prompt, tools=tools)
```

### DynamoDB 테이블 접근 격리

```python
# CM: DYNAMODB_TABLE_PREFIX=aigo  → aigo-Jobs, aigo-Incidents ...
# IM: IM_TABLE_PREFIX=aigo-im     → aigo-im-Incidents, aigo-im-InvestigationResults ...

class IMBaseConfig(BaseAgentConfig):
    dynamodb_table_prefix: str = Field(
        default_factory=lambda: os.environ.get("IM_TABLE_PREFIX", "aigo-im")
    )
    # BaseAgentConfig.table() 그대로 사용 → "aigo-im-{name}"
```

---

## 에이전트 구조 요약

Change Management의 `orchestrator`와 완전히 별도의 Strands 에이전트들입니다.
코드 위치, IAM Role, Lambda 함수명 모두 분리됩니다.

```
poll_investigation         Step Functions Task — 조사 시작, supervisor 비동기 호출 (plain Python)

supervisor_agent           scope + summary 병렬 실행 조율 (plain Python, ThreadPoolExecutor)
    ├── scope_agent        근본 원인·영향 범위 분석 (Strands Agent)
    └── summary_agent      한국어 보고서 생성 + S3 + SES (Strands Agent)

security_event_handler     GuardDuty 이벤트 수신 → security_agent 비동기 호출 (plain Python)
    └── security_agent     보안 분석, 대응 플레이북 생성 (Strands Agent)

chat_agent                 리소스 진단 AI 채팅 (Strands Agent, 독립 실행)
action_executor            승인된 복구 조치 실행 (plain Python, Strands 아님)
```

---

## 1. supervisor_agent

**Lambda**: `aigo-im-supervisor-agent`  
**위치**: `agents/im-supervisor/`  
**트리거**: Step Functions Task (동기 실행, timeout 14분)  
**메모리**: 512MB

### 역할
scope_agent와 summary_agent를 병렬로 호출하고 결과를 통합합니다.
직접 Bedrock을 호출하지 않고 조율만 담당합니다.

### 실행 로직
```python
def lambda_handler(event, context):
    incident_id = event['incidentId']
    incident = fetch_incident(incident_id)      # DDB 읽기

    # Strands를 통해 두 에이전트 병렬 호출
    with ThreadPoolExecutor(max_workers=2) as executor:
        scope_future   = executor.submit(invoke_scope_agent,   incident)
        summary_future = executor.submit(invoke_summary_agent, incident)
        scope_result   = scope_future.result(timeout=600)
        summary_result = summary_future.result(timeout=600)

    update_incident_status(incident_id, 'REPORTED')
    return { 'incidentId': incident_id, 'status': 'REPORTED' }
```

### 도구
```python
@tool
def invoke_scope_agent(incident: dict) -> dict:
    """scope_agent Lambda를 동기 호출해 원인 분석 결과 반환"""

@tool
def invoke_summary_agent(incident: dict) -> dict:
    """summary_agent Lambda를 동기 호출해 보고서 생성"""

@tool
def update_incident_status(incident_id: str, status: str) -> None:
    """DDB aigo-im-Incidents 상태 업데이트"""
```

---

## 2. scope_agent

**Lambda**: `aigo-im-scope-agent`  
**위치**: `agents/im-scope/`  
**트리거**: supervisor_agent Lambda 직접 호출  
**메모리**: 1024MB  
**timeout**: 600s

### 역할
CloudWatch 로그·메트릭·리소스 상태를 조회해 근본 원인과 영향 범위를 분석합니다.
분석 결과와 복구 방안 후보를 `aigo-im-InvestigationResults`에 저장합니다.

### 시스템 프롬프트
```
당신은 AWS 인프라 장애 분석 전문가입니다.
주어진 CloudWatch 알람 데이터와 리소스 상태를 분석하여:
1. 근본 원인 (rootCause): 구체적이고 명확하게
2. 영향 범위 (blastRadius): 영향받는 서비스·리소스 목록
3. 이벤트 타임라인: 시간순 정렬
4. 복구 방안 (recoveryOptions): 위험도 낮은 것부터 나열, allowedActionId 포함

규칙:
- 추측하지 말고 데이터 기반으로 분석
- 데이터 부족 시 confidence 낮게 표시
- 복구 방안은 반드시 AllowedActions에 등록된 것만 제안
```

### 도구
```python
@tool
def get_cloudwatch_alarms(incident_id: str, time_window_minutes: int = 60) -> list:
    """발생 시점 전후 관련 CloudWatch 알람 목록 조회"""

@tool
def get_cloudwatch_metrics(namespace: str, metric_name: str,
                           dimensions: dict, period_minutes: int) -> dict:
    """CPU, 메모리, 에러율, 레이턴시 등 메트릭 조회"""

@tool
def get_cloudwatch_logs(log_group: str, start_time: str,
                        end_time: str, filter_pattern: str) -> list:
    """CloudWatch Logs Insights 쿼리 실행"""

@tool
def describe_ec2_instances(instance_ids: list) -> list:
    """EC2 인스턴스 상태·타입·태그 조회"""

@tool
def describe_rds_instances(db_instance_identifiers: list) -> list:
    """RDS 인스턴스 상태·엔진·파라미터 조회"""

@tool
def describe_ecs_services(cluster: str, services: list) -> list:
    """ECS 서비스 desired/running count, 이벤트 조회"""

@tool
def get_aws_health_events(service: str, region: str) -> list:
    """AWS 서비스 헬스 이벤트 조회 (AWS Health API)"""

@tool
def get_allowed_actions(org_id: str) -> list:
    """복구 방안 제안 시 참조할 허용 작업 목록 조회"""

@tool
def save_investigation_result(incident_id: str, result: dict) -> None:
    """분석 결과를 aigo-im-InvestigationResults에 저장"""
```

---

## 3. summary_agent

**Lambda**: `aigo-im-summary-agent`  
**위치**: `agents/im-summary/`  
**트리거**: supervisor_agent Lambda 직접 호출  
**메모리**: 512MB  
**timeout**: 300s

### 역할
scope_agent 결과와 인시던트 원본 데이터를 종합해 한국어 장애 보고서를 생성합니다.
Markdown 형식으로 S3에 저장하고 SES로 이메일을 발송합니다.

### 보고서 구조
```markdown
# 장애 보고서 — [P1] prod-api CPU 급등

## 요약
발생 시각: 2026-06-21 12:00 KST
감지 시각: 2026-06-21 12:00:30 KST (30초 내 감지)
영향 서비스: production API 서버 (i-0abc123)
심각도: P1 (서비스 중단)

## 근본 원인
메모리 누수로 인한 OOM(Out of Memory) 상황 발생.
트래픽 급증과 맞물려 GC 과부하 → 응답 불가 상태 진입.

## 영향 범위
- EC2: i-0abc123 (prod-api-server) — CPU 98%, 응답 없음
- RDS: 연결 대기 큐 포화 (현재 연결 수 482/500)
- API Gateway: 5xx 에러율 67%

## 이벤트 타임라인
| 시각 | 이벤트 |
|------|--------|
| 11:58 | 트래픽 평소 대비 3배 증가 감지 |
| 11:59 | EC2 CPU 95% 초과 알람 |
| 12:00 | API Gateway 5xx 에러율 50% 초과 |

## 권장 복구 방안
1. [즉시, LOW 위험] EC2 인스턴스 재부팅 (예상 복구: 3분)
2. [중기, MEDIUM 위험] ECS Auto Scaling 임계값 하향 조정
```

### 도구
```python
@tool
def get_incident_data(incident_id: str) -> dict:
    """aigo-im-Incidents + aigo-im-InvestigationResults 조회"""

@tool
def generate_report_content(incident: dict, scope: dict) -> str:
    """Bedrock Claude로 한국어 Markdown 보고서 생성"""

@tool
def save_report_to_s3(incident_id: str, content: str) -> str:
    """S3 aigo-im-reports 버킷에 저장, s3Key 반환"""

@tool
def send_report_email(incident_id: str, s3_key: str,
                      recipients: list, summary: str) -> None:
    """SES로 보고서 요약 + S3 링크 이메일 발송"""

@tool
def save_report_metadata(incident_id: str, s3_key: str,
                         summary: str, recipients: list) -> None:
    """aigo-im-Reports DDB에 메타데이터 저장"""
```

---

## 4. chat_agent

**Lambda**: `aigo-im-chat-agent`  
**위치**: `agents/im-chat/`  
**트리거**: API Gateway POST `/im/chat`  
**메모리**: 512MB  
**timeout**: 60s

### 역할
특정 인시던트에 대한 자연어 Q&A. 인시던트 분석 결과를 컨텍스트로 보유한 채 Claude와 대화합니다.

### 실행 흐름
```python
def lambda_handler(event, context):
    incident_id = event['incidentId']
    user_message = event['message']
    conv_id      = event.get('convId')    # 기존 대화 이어가기

    # 인시던트 컨텍스트 로드 (DDB)
    context_data = load_incident_context(incident_id)

    # 대화 이력 로드 (있으면)
    history = load_conversation(conv_id) if conv_id else []

    # Strands Agent 실행
    response = agent.run(
        user_message,
        system_context=context_data,
        conversation_history=history
    )

    # 대화 이력 저장
    save_conversation(conv_id or new_conv_id, incident_id, user_message, response)
    return { 'response': response, 'convId': conv_id }
```

### 도구
```python
@tool
def get_incident_summary(incident_id: str) -> dict:
    """인시던트 기본 정보 + 현재 상태 조회"""

@tool
def get_scope_analysis(incident_id: str) -> dict:
    """scope_agent 분석 결과 조회"""

@tool
def get_metrics_at_time(resource_id: str, metric: str, timestamp: str) -> dict:
    """특정 시점의 CloudWatch 메트릭 조회"""

@tool
def get_recovery_status(incident_id: str) -> list:
    """진행 중인 복구 작업 현황 조회"""
```

---

## Change Management Agent와의 차이

| 항목 | Change Management (orchestrator) | Incident Management (im-*) |
|------|----------------------------------|---------------------------|
| 위치 | `agents/orchestrator/` | `agents/im-*/` |
| IAM Role | `aigo-orchestrator-role` | `aigo-im-*-role` (각각 분리) |
| Lambda명 | `aigo-orchestrator` | `aigo-im-supervisor-agent` 등 |
| 트리거 | SQS (analysis-queue.fifo) | Step Functions / API GW |
| 분석 대상 | GitHub PR 코드 변경 | AWS 인프라 장애 |
| 출력 | PR 리뷰 + Slack | 한국어 보고서 + SES + 복구 실행 |
| 리소스 태그 | Product=ChangeManagement | Product=IncidentManagement |
