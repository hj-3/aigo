# Bedrock AgentCore + Knowledge Base Terraform 구현

## 개요

7개 Strands Agent를 AWS Bedrock Agents로 배포하는 인프라와,
단일 Knowledge Base(4개 도메인 데이터 소스)를 Terraform으로 구현했다.

## 신규 Terraform 모듈

### modules/bedrock-kb

| 리소스 | 설명 |
|--------|------|
| `aws_iam_role.bedrock_kb` | Bedrock KB 서비스 실행 역할 (S3 + AOSS + Titan 모델 권한) |
| `aws_opensearchserverless_security_policy` × 2 | 암호화 정책, 네트워크 정책 (public — Bedrock 접근 필요) |
| `aws_opensearchserverless_access_policy` | Bedrock KB 역할의 AOSS 인덱스 접근 권한 |
| `aws_opensearchserverless_collection` | `{project}-vectors` 벡터 스토어 컬렉션 |
| `aws_bedrockagent_knowledge_base` | 단일 KB (`{project}-knowledge-base`) |
| `aws_bedrockagent_data_source` × 4 | coding-standards/, infrastructure-standards/, security-policies/, risk-policies/ S3 prefix별 데이터 소스 |

**KB 도메인 구분 방식**: 1개 KB + 4개 데이터 소스. 각 문서에 `.metadata.json` 사이드카 파일이
있어야 하며 `{"metadataAttributes":{"category":"coding_standards"}}` 형태로 카테고리를 명시한다.
`kb_tools.py`의 `filter_tag`가 이 metadata를 기준으로 검색한다.

**임베딩 모델**: `amazon.titan-embed-text-v2:0` (다국어 지원, 1024 차원)

### modules/bedrock-agentcore

| 리소스 | 설명 |
|--------|------|
| `aws_iam_role.bedrock_agent` | Bedrock Agent 서비스 실행 역할 |
| `aws_iam_role_policy.bedrock_agent` | InvokeModel + Retrieve KB + S3 agent-packages 권한 |
| `aws_bedrockagent_agent` × 7 | 7개 Agent (orchestrator, code-reviewer, infra-reviewer, risk-reviewer, security-agent, incident-agent, fix-agent) |
| `aws_bedrockagent_agent_alias` × 7 | 각 Agent의 `live` alias |
| `aws_ssm_parameter` × 21 | agent-id, alias-id, alias-arn 각각 7개씩 SSM 저장 |

**모델**: `us.anthropic.claude-sonnet-4-6-20250514-v1:0` (cross-region inference profile)  
**Memory**: `SESSION_SUMMARY` 30일 보존  
**지시문**: `prompts/v1/{name}.md` 파일을 `file()` 함수로 주입

## S3 변경

`modules/s3/main.tf`에 `agent_packages` 버킷 추가:
- 버킷명: `{project}-agent-packages`
- 버전 관리: ON
- 라이프사이클: 180일

## IAM 변경

`global/iam/main.tf` github-actions-deploy 역할에 추가 권한:
- `bedrock:PrepareAgent`, `CreateAgentVersion`, `UpdateAgent`, `GetAgent`, `UpdateAgentAlias`, `GetAgentAlias`, `ListAgentVersions`
- `ssm:GetParameter`, `GetParameters` (agent-id, alias-id 조회용)
- `s3:PutObject`, `GetObject`, `ListBucket` on agent-packages 버킷
- 기존 S3ArtifactsDeploy 권한의 Resource ARN 오류 수정 (`arn:aws:s3:::` prefix 추가)

## scripts/deploy-agent.sh 수정

`update-agent` API 호출 누락 보완:
- `prepare-agent` 전에 `update-agent`로 instruction 업데이트 추가
- `PROMPT_CONTENT` 변수가 실제로 Bedrock에 전달되도록 수정

## 환경변수 매핑

Lambda 공통 환경변수 (`envs/prod/main.tf`)에 추가:

| 환경변수 | 참조 | 사용처 |
|---------|------|--------|
| `BEDROCK_KB_ID` | `module.bedrock_kb.knowledge_base_id` | `kb_tools.py` |
| `ORCHESTRATOR_AGENT_ID` | `module.bedrock_agentcore.agent_ids["orchestrator"]` | `agentcore-client.ts` |
| `ORCHESTRATOR_AGENT_ALIAS_ID` | `module.bedrock_agentcore.agent_alias_ids["orchestrator"]` | `agentcore-client.ts` |
| `CODE_REVIEWER_AGENT_ID` / `CODE_REVIEWER_ALIAS_ID` | bedrock_agentcore 출력 | `subagent_tools.py` |
| `INFRA_REVIEWER_AGENT_ID` / `INFRA_REVIEWER_ALIAS_ID` | bedrock_agentcore 출력 | `subagent_tools.py` |
| `RISK_REVIEWER_AGENT_ID` / `RISK_REVIEWER_ALIAS_ID` | bedrock_agentcore 출력 | `subagent_tools.py` |
| `SECURITY_AGENT_ID` / `SECURITY_ALIAS_ID` | bedrock_agentcore 출력 | `subagent_tools.py` |
| `INCIDENT_AGENT_ID` / `INCIDENT_AGENT_ALIAS_ID` | bedrock_agentcore 출력 | ECS heavy worker |
| `FIX_AGENT_ID` / `FIX_AGENT_ALIAS_ID` | bedrock_agentcore 출력 | ECS heavy worker |

## KB 문서 적재 방법

1. S3 버킷 `{project}-kb`에 카테고리별 prefix로 문서 업로드
2. 각 문서 옆에 `.metadata.json` 사이드카 파일 생성:
   ```json
   { "metadataAttributes": { "category": "coding_standards" } }
   ```
3. Bedrock Console 또는 `aws bedrock-agent start-ingestion-job` CLI로 동기화 트리거

## 배포 순서

```
terraform apply  # Bedrock KB + AgentCore 리소스 생성
./scripts/deploy-agent.sh orchestrator   # 7개 agent 순서대로 배포
./scripts/deploy-agent.sh code-reviewer
... (나머지 5개)
```
