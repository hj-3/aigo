# AIGO Incident Management — 문서 인덱스

Change Management와 **완전히 분리된 독립 백엔드 서비스**입니다.
대시보드 프런트엔드(`app.seolphung.com`)에서 IM 전용 API(`im-api.seolphung.com`)를 호출합니다.

## 문서 목록

| 파일 | 내용 |
|------|------|
| [01-overview.md](./01-overview.md) | 서비스 개요, 7개 탭 기능, 입력 소스 |
| [02-architecture.md](./02-architecture.md) | 전체 아키텍처, URL 구조, 서비스 분리 모델 |
| [03-data-model.md](./03-data-model.md) | DynamoDB 테이블 11개 스키마 |
| [04-agents.md](./04-agents.md) | Strands Agent 상세 스펙 |
| [05-api-design.md](./05-api-design.md) | REST API 엔드포인트 |
| [06-infra-isolation.md](./06-infra-isolation.md) | Terraform 분리 전략, data source 패턴 |
| [07-implementation-plan.md](./07-implementation-plan.md) | Phase별 구현 계획 |
| [08-build-plan.md](./08-build-plan.md) | 신규 생성 리소스 전체 목록, 파일 구조, 배포 방법, 기존 코드 수정 최소화 계획 |

## 인프라 분리 원칙

```
Change Management (기존)
  infra/terraform/envs/prod/           ← 기존 Terraform state
  S3 backend: aigo-tf-state / prod/terraform.tfstate
  생성: VPC, Cognito, CloudFront, API GW, DynamoDB, SQS, EventBridge, KMS 등

Incident Management (신규, 완전 별도)
  services/incident-management/infra/terraform/envs/prod/
  S3 backend: aigo-tf-state / services/im/prod/terraform.tfstate
  생성: IM API GW, IM Lambda × 9, IM DynamoDB × 11, Step Functions 등
  참조: data source로 CM의 VPC, Cognito, Route53, ACM, SES 읽기 (state 간 직접 참조 없음)
```
