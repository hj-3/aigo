# AgentOps Platform — 비용 절감 Terraform 운영 런북

> 서비스를 구동하는데 필수가 아닌 고비용 리소스를 내리고 다시 올리는 절차.  
> 현재 상태와 복구 방법을 명확히 기록한다.

---

## 현재 비활성화된 리소스 (2026-06-15 기준)

| 리소스 | 상태 | 월 절감 | 영향 |
|--------|------|---------|------|
| Amazon OpenSearch Serverless (AOSS) | **비활성** | ~$692 | KB RAG 기능 비활성 (AI 분석은 정상) |
| Bedrock Knowledge Base | **비활성** | 포함 위 | KB RAG 기능 비활성 |
| VPC Interface Endpoints (11개) | **비활성** | ~$145 | Lambda가 NAT Gateway 경유 — 기능 영향 없음 |

**합계 절감: ~$837/월**

---

## 서비스 구동 가능 여부

KB와 VPC 엔드포인트 없이도 서비스의 핵심 기능은 모두 정상 동작한다.

| 기능 | KB 없이 동작 여부 | 비고 |
|------|-------------------|------|
| GitHub Webhook 수신 | ✅ | |
| PR 분석 (AI) | ✅ | Bedrock AgentCore 직접 호출, KB context 없이 동작 |
| 대시보드 조회/승인 | ✅ | |
| Fix PR 생성 | ✅ | |
| 인시던트 조사 | ✅ | |
| Slack 알림 | ✅ | |
| Cognito 로그인 | ✅ | |
| KB RAG (코딩 표준 참조) | ❌ | `BEDROCK_KB_ID = ""` → KB 조회 없이 분석 |

> KB가 없어도 Bedrock AgentCore 에이전트는 자체 모델 지식으로 분석함.
> KB는 분석 품질 향상 목적이지 필수 의존성이 아님.

---

## Terraform 코드 상태 (현재)

KB/AOSS는 `infra/terraform/modules/bedrock-kb/main.tf`의 `enabled` 변수로 제어됨.

```hcl
# infra/terraform/envs/prod/main.tf
module "bedrock_kb" {
  ...
  enabled = false  # AOSS ~$692/month — disabled until pgvector migration
}
```

VPC 엔드포인트는 `infra/terraform/modules/vpc/main.tf`의 `enable_interface_endpoints` 변수로 제어됨.

```hcl
# infra/terraform/envs/prod/main.tf
module "vpc" {
  ...
  enable_interface_endpoints = false  # VPC endpoints ~$145/month — use NAT Gateway until launch
}
```

---

## 복구 절차

### KB + AOSS 다시 올리기

```bash
# infra/terraform/envs/prod/main.tf 수정:
# module "bedrock_kb" 블록에서
#   enabled = false → enabled = true

cd infra/terraform/envs/prod
terraform apply
```

> 약 10분 소요 (AOSS collection 프로비저닝 시간).  
> apply 완료 후 Lambda의 `BEDROCK_KB_ID` env var가 자동으로 새 KB ID로 업데이트됨.

### VPC Interface Endpoints 다시 올리기

```bash
# infra/terraform/envs/prod/main.tf 수정:
# module "vpc" 블록에서
#   enable_interface_endpoints = false → enable_interface_endpoints = true

cd infra/terraform/envs/prod
terraform apply
```

### 둘 다 한번에 올리기

```bash
# infra/terraform/envs/prod/main.tf 에서 두 플래그 모두 true로 변경:
#   module "bedrock_kb" { enabled = true }
#   module "vpc" { enable_interface_endpoints = true }

cd infra/terraform/envs/prod
terraform apply
```

---

## 현황 확인 명령어

```bash
# AOSS 컬렉션 존재 여부
aws opensearchserverless list-collections \
  --query 'collectionSummaries[].{name:name,status:status}'

# VPC 엔드포인트 목록
aws ec2 describe-vpc-endpoints \
  --filters 'Name=tag:Project,Values=aigo' 'Name=vpc-endpoint-type,Values=Interface' \
  --query 'VpcEndpoints[].{id:VpcEndpointId,service:ServiceName,state:State}' \
  --output table

# Lambda 함수 목록 (모두 있어야 정상)
aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `aigo-`)].FunctionName' \
  --output text | tr '\t' '\n' | sort

# API Gateway 라우트 목록
API_ID=$(aws apigatewayv2 get-apis \
  --query 'Items[?Name==`aigo-api`].ApiId' --output text)
aws apigatewayv2 get-routes --api-id "$API_ID" \
  --query 'Items[*].RouteKey' --output text | tr '\t' '\n' | sort
```

---

## AOSS 대안 — Aurora PostgreSQL pgvector

장기적으로 AOSS 대신 Aurora Serverless v2 pgvector로 교체하면 비용을 낮출 수 있음.

| 항목 | 비용 |
|------|------|
| Aurora Serverless v2 (0.5 ACU 최소) | ~$43/월 |
| AOSS 대비 절감 | ~$650/월 |

> 교체 작업: `modules/bedrock-kb` 모듈 수정 + `storage_configuration.type = "RDS"` 변경 필요.

---

## 주의사항 — Terraform `-target` destroy 금지

이전 운영 중 `terraform destroy -target` 실행 시 예상치 못한 cascade 삭제가 발생했음.

**원인**: `lambda_common_env.BEDROCK_KB_ID = module.bedrock_kb.knowledge_base_id` 의존성으로  
`-target` destroy가 Lambda 함수 8개 + API Gateway 라우트 전체를 연쇄 삭제.

**대안**: 리소스를 내릴 때는 반드시 `enabled = false` 코드 변경 후 `terraform apply` 사용.  
`terraform destroy -target`은 leaf 리소스(의존성 없는 리소스)에만 사용 가능.
