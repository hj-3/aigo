# DR 리소스 제거 및 원칙 추가

## 개요

초기 서비스 구축에 집중하기 위해 재해 복구(DR) 관련 Terraform 리소스를 제거하고,
공식 문서 기반 검증 원칙을 추가했다.

## 변경 사항

### 1. 공식 문서 기반 검증 원칙 추가

`docs/00-overview.md` 작업 관리 원칙 섹션에 추가:
- 모든 구현은 해당 서비스·라이브러리의 공식 문서를 기준으로 검증
- 비공식 방식, deprecated API, 문서화되지 않은 내부 동작 의존 금지

### 2. Terraform DR 리소스 제거

#### modules/kms/main.tf
- `aws_kms_key.dynamodb`: `multi_region = true` → `multi_region = false`
- `aws_kms_key.s3`: `multi_region = true` → `multi_region = false`

#### modules/dynamodb/main.tf
- 13개 테이블 전체에서 `dynamic "replica"` 블록 제거

#### modules/dynamodb/variables.tf
- `enable_global_tables` 변수 제거
- `replica_regions` 변수 제거

#### envs/prod/variables.tf
- `dr_region` 변수 제거
- `enable_global_tables` 변수 제거

#### envs/prod/backend.tf
- `provider "aws" { alias = "dr" }` 블록 제거

#### envs/prod/main.tf
- dynamodb 모듈 호출에서 `enable_global_tables`, `replica_regions` 인수 제거

#### envs/prod/terraform.tfvars.example
- `dr_region` 항목 제거
- `enable_global_tables` 항목 제거

## 결정 배경

초기 서비스 출시 단계에서는 단일 리전(ap-northeast-2 서울) 운영으로 충분하다.
DynamoDB Global Tables와 KMS 멀티 리전 키는 추가 비용과 운영 복잡도를 수반하므로
서비스 안정화 이후 필요 시 도입하기로 했다.

## 재해 복구 추후 고려사항

아래 항목은 서비스 안정화 이후 필요 시 도입을 검토한다:

- **DynamoDB Global Tables**: `dynamic "replica"` 블록 복원 + `enable_global_tables` 변수 재추가
- **KMS 멀티 리전 키**: `multi_region = true` 복원 (기존 키는 삭제 후 재생성 필요)
- **S3 Cross-Region Replication**: `modules/s3/main.tf`에 CRR 규칙 추가
- **RTO/RPO 목표 설정**: 비즈니스 요구사항 확정 후 DR 전략 수립
- **DR 리전 선택**: ap-northeast-1(도쿄)이 가장 가까운 대안

## 현재 데이터 복구 보장 수단 (단일 리전)

DR 리소스 없이도 다음이 적용된 상태:
- **PITR (Point-In-Time Recovery)**: 13개 DynamoDB 테이블 전체 활성화
- **S3 버전 관리**: 모든 버킷 활성화
- **KMS 키 회전**: 30일 삭제 보호 기간 + 자동 키 회전
- **CloudWatch 백업 모니터링**: DLQ 알람 및 SNS 알림
