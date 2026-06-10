# 재해 복구 전략

## 개요

**Primary Region**: `ap-northeast-2` (Seoul)  
**DR Region**: `ap-northeast-1` (Tokyo)  
**전략**: Active-Passive (평상시 Seoul에서 운영, 장애 시 Tokyo로 전환)

---

## RTO / RPO 목표

| 티어 | 컴포넌트 | RTO | RPO | 전략 |
|------|---------|-----|-----|------|
| T0 (Critical) | Webhook 수신, SQS, 이벤트 큐 | < 5분 | 0 | SQS 영구 저장, Multi-AZ 기본 |
| T1 (High) | 분석 파이프라인, AgentCore, Dashboard API | < 15분 | < 5분 | Lambda Multi-AZ + DynamoDB Global Tables |
| T2 (Medium) | Dashboard UI, Fix Center | < 1시간 | < 15분 | CloudFront + S3 CRR |
| T3 (Low) | 과거 리포트, Audit Log, RCA | < 4시간 | < 1시간 | S3 CRR + DynamoDB Export |

---

## 아키텍처 내 내결함성

### 자동으로 Multi-AZ가 보장되는 서비스

서버리스 기반 아키텍처의 핵심 장점이다. 추가 설정 없이 AZ 장애를 견딘다.

| 서비스 | Multi-AZ 방식 |
|--------|---------------|
| Lambda | AWS 자동 관리 |
| API Gateway | AWS 자동 관리 |
| SQS | AWS 자동 관리 (3 AZ 복제) |
| DynamoDB | AWS 자동 관리 (3 AZ 복제) |
| S3 | AWS 자동 관리 (최소 3 AZ) |
| Secrets Manager | AWS 자동 관리 |
| CloudFront | 글로벌 PoP |

### ECS Fargate (RunTask)

RunTask 방식이므로 지속 상태 없음. SQS 메시지가 살아있으면 다른 AZ에서 Task 재실행.  
ECS Cluster 자체는 Multi-AZ Private Subnet에 Task 실행 설정.

### AgentCore Runtime

AWS 관리형 서비스. AZ 장애 시 AWS가 자동 처리.  
단, 리전 장애 시 DR 리전에서 재배포 필요 → 아래 Failover 절차 참조.

---

## 백업 전략

### DynamoDB

| 항목 | 설정 |
|------|------|
| PITR (Point-in-Time Recovery) | 모든 테이블 항상 활성화 (최대 35일 이전 복구) |
| On-demand Backup | 주요 배포 전 수동 스냅샷 |
| Export to S3 | 매일 01:00 UTC, `aigo-backup/dynamodb/{tableName}/{date}/` |
| Global Tables | Reports, Findings, Incidents, AuditLogs → Tokyo 실시간 복제 |

**PITR 복구 절차**:
```
1. AWS Console → DynamoDB → 대상 테이블 → Backups
2. "Restore to point in time" 선택
3. 복구 시점 지정 (최대 35일 전)
4. 새 테이블 이름으로 복구 (기존 테이블 덮어쓰기 불가)
5. 애플리케이션 테이블 참조 변경 또는 데이터 마이그레이션
```

### S3

| 버킷 | 버전 관리 | CRR (Cross-Region Replication) |
|------|-----------|-------------------------------|
| `aigo-reports` | ON | → `aigo-reports-dr` (Tokyo) |
| `aigo-incidents` | ON | → `aigo-incidents-dr` (Tokyo) |
| `aigo-patches` | ON | 없음 (재생성 가능) |
| `aigo-diffs` | OFF | 없음 (재조회 가능) |
| `aigo-backup` | ON | → `aigo-backup-dr` (Tokyo) |
| `aigo-kb` | ON | → `aigo-kb-dr` (Tokyo) |
| `aigo-tf-state` | ON | → `aigo-tf-state-dr` (Tokyo) |

**S3 버전 복원 절차**:
```
aws s3api list-object-versions --bucket aigo-reports --prefix "orgId/reportId/"
aws s3api restore-object --bucket aigo-reports --key "..." --version-id "{versionId}"
```

### Secrets Manager

모든 Secret을 Tokyo로 크로스 리전 복제.
```
Primary:   ap-northeast-2/secretsmanager/aigo/*
Replica:   ap-northeast-1/secretsmanager/aigo/* (자동 동기화)
```

### ECR 이미지

```
Primary:   ap-northeast-2 ECR: aigo-heavy-worker:{tag}
Replica:   ap-northeast-1 ECR: aigo-heavy-worker:{tag} (자동 복제 정책)

복제 정책: 모든 태그 (v*.*.*)
```

---

## 장애 유형별 대응

### AZ 단일 장애

**영향**: 특정 AZ의 ECS Task, NAT Gateway 일시 불능  
**대응**: 자동 복구. 별도 조치 불필요  
**소요 시간**: 수 초 ~ 수 분 (AWS 자동 처리)

```
[자동 복구]
Lambda: 다른 AZ에서 자동 실행
SQS: 다른 AZ에서 자동 소비
ECS RunTask: SQS 메시지 기반 재시도 → 다른 AZ에서 Task 실행
DynamoDB: 다른 AZ 자동 사용
```

### 리전 장애 (Seoul 전체)

**영향**: 서비스 전체 중단  
**대응**: Tokyo Failover 실행 (수동 트리거)  
**목표 RTO**: < 30분

**Failover 절차**:

```
1. [자동] Route 53 Health Check → Seoul 응답 없음 감지
          → DNS Failover → Tokyo API Gateway/CloudFront로 전환
          소요: < 60초

2. [수동] On-call 엔지니어 Slack 알람 확인
          → DR Runbook 실행 (docs/runbooks/dr-failover.md)

3. [수동] Tokyo에 Lambda/API Gateway 배포
          GitHub Actions → "Deploy to DR" 워크플로우 수동 트리거
          - AWS 자격증명: ap-northeast-1용 OIDC Role 사용
          - Terraform apply (infra/terraform/envs/prod + region override)
          소요: < 15분

4. [자동] DynamoDB Global Tables → Tokyo에서 바로 사용 가능

5. [자동] S3 CRR → Tokyo DR 버킷에서 데이터 사용 가능

6. [수동] AgentCore Runtime → Tokyo에 재배포
          deploy-agent.sh --region ap-northeast-1
          소요: < 10분

7. [확인] Smoke Test 실행
          curl https://api.{domain}/health
          소요: < 5분

총 소요: < 30분
```

### 데이터 손상 또는 실수 삭제

**DynamoDB**:
```
1. 손상 범위 파악 (CloudTrail로 쓰기 이벤트 추적)
2. PITR로 특정 시점 복구:
   - 손상 발생 직전 시점 선택
   - 새 테이블으로 복구
3. 복구된 테이블과 현재 테이블 데이터 병합 (필요 시)
4. 테이블 교체 또는 데이터 마이그레이션
```

**S3**:
```
1. 삭제된 오브젝트: aws s3api list-object-versions로 이전 버전 확인
2. 이전 버전 복원:
   aws s3api restore-object --bucket {bucket} --key {key} --version-id {versionId}
```

### Agent 이상 동작

**증상**: Agent가 잘못된 Finding 생성, 무한 루프, 비정상 Tool 호출  
**대응**:

```
1. CloudWatch Alarm: AgentCore 에러율 임계치 초과
2. Slack 알림 → On-call 확인
3. 즉시 조치:
   - AgentCore Runtime 해당 Agent 버전 롤백
   - SQS analysis-queue Visibility Timeout 연장 (분석 지연)
4. 근본 원인 조사:
   - AgentRuns DynamoDB에서 실패 로그 확인
   - S3 agent-outputs/에서 raw output 확인
5. 프롬프트 수정 또는 로직 수정 → 재배포
```

**Circuit Breaker 패턴**:
```
Agent 연속 5회 실패 → Orchestrator가 해당 Agent 비활성화
비활성화 시 → 나머지 Agent로 partial analysis 진행
관리자 수동 재활성화 또는 배포 후 자동 활성화
```

---

## Route 53 헬스체크 및 DNS Failover

```
Health Check:
  - Endpoint: https://api.{domain}/health
  - 인터벌: 30초
  - 실패 기준: 연속 3회 응답 없음 또는 5xx
  - 알림: SNS → Slack

DNS Failover:
  - Primary: ap-northeast-2 API Gateway (가중치 100%)
  - Secondary: ap-northeast-1 API Gateway (Failover record)
  - TTL: 60초 (빠른 전환을 위해 낮게 설정)
  - 전환 조건: Primary Health Check 실패 시 자동 Secondary로 전환
```

---

## Terraform 기반 재배포

모든 인프라는 Terraform으로 코드화되어 있어, 새 리전에서도 `terraform apply` 한 번으로 전체 인프라 재현 가능.

```bash
# DR 리전 (Tokyo)에 인프라 배포
cd infra/terraform/envs/prod
terraform init -backend-config="region=ap-northeast-1"
terraform apply -var="aws_region=ap-northeast-1"
```

> Terraform 상태는 Seoul에만 있으므로, DR 시나리오에서 Tokyo 신규 배포는 새 상태 파일로 시작.
> Seoul 복구 후 상태 병합 또는 Tokyo를 새 Primary로 전환.

---

## DR 훈련 계획

| 훈련 | 주기 | 내용 | 담당 |
|------|------|------|------|
| DynamoDB PITR 복구 테스트 | 분기 | 특정 시점으로 테이블 복구 → 데이터 검증 | 인프라팀 |
| S3 오브젝트 복원 테스트 | 분기 | 버전 복원 절차 실행 | 인프라팀 |
| Lambda 롤백 테스트 | 월 | Alias 이전 버전 복원 | 개발팀 |
| 리전 Failover 훈련 | 반기 | Seoul → Tokyo 전체 전환 → 서비스 검증 → 복원 | 전체팀 |
| 침투 테스트 | 연 | 외부 보안 전문 기관 | 보안팀 |

---

## 운영 Runbook 위치

| 문서 | 경로 |
|------|------|
| DR Failover 절차 | `docs/runbooks/dr-failover.md` |
| Incident 대응 절차 | `docs/runbooks/incident-response.md` |
| Lambda 롤백 절차 | `docs/runbooks/rollback.md` |
| DynamoDB 복구 절차 | `docs/runbooks/dynamodb-recovery.md` |

---

## 백업 비용 추정

| 항목 | 비용 기준 |
|------|-----------|
| DynamoDB PITR | 테이블 크기 × $0.20/GB/월 |
| DynamoDB Global Tables | 복제 RCU/WCU 추가 비용 |
| S3 CRR 데이터 전송 | $0.02/GB (Seoul → Tokyo) |
| S3 DR 버킷 스토리지 | 동일 스토리지 요금 |
| Route 53 Health Check | $0.50/헬스체크/월 |
| ECR 크로스 리전 복제 | 데이터 전송 비용 |
