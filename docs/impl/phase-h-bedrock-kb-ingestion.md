# Phase H: 배포 전 운영 준비 (Deployment Pre-ops)

> 인프라 배포 완료 후, 에이전트 서비스 가동 전에 수행해야 하는 운영 준비 작업.  
> Phase A–G는 구현 단계, Phase H는 데이터·설정 준비 단계.

---

## 상태 요약

| 단계 | 작업 | 상태 | 완료일 |
|------|------|------|--------|
| H-1 | Cognito User Pool 존재 확인 | ✅ DONE | 2026-06-09 |
| H-2 | DynamoDB Organizations 초기 레코드 생성 | ✅ DONE | 2026-06-09 |
| H-3-1 | Knowledge Base 문서 생성 + S3 업로드 | ✅ DONE | 2026-06-09 |
| H-3-2 | KB Data Source 4개 ingestion 시작 | ✅ DONE | 2026-06-09 |
| H-3-3 | KB Data Source 4개 ingestion COMPLETE 확인 | ✅ DONE | 2026-06-11 |

---

## H-1: Cognito User Pool 확인

**목적**: 이전 세션에서 Terraform으로 생성한 Cognito User Pool이 실제로 존재하는지 확인.

**확인 결과**:
```
User Pool ID  : ap-northeast-2_AKb8Xkx3b
Name          : aigo-user-pool
Status        : ACTIVE
Region        : ap-northeast-2
```

**관련 수정사항** (H-1 과정에서 함께 적용):
- 비밀번호 최소 길이: 12자 → 8자 (`modules/cognito/main.tf`)
- Cognito Managed Login 활성화 (`managed_login_version = 2` + `aws_cognito_managed_login_branding`)
- redirect_mismatch 수정 (callback URL에 CloudFront 도메인 추가, 경로 `/auth/callback` → `/`)
- cicd-fixes.md #28, #29, #30 참조

---

## H-2: DynamoDB Organizations 초기 레코드

**목적**: aigo 플랫폼이 처음 기동될 때 참조할 기본 조직(DEFAULT_ORG) 레코드를 DynamoDB에 생성.

**테이블**: `aigo-main` (DynamoDB)

**생성한 레코드**:
```json
{
  "PK": "ORG#DEFAULT",
  "SK": "METADATA",
  "orgId": "DEFAULT",
  "name": "Default Organization",
  "createdAt": "2026-06-09T00:00:00Z",
  "status": "ACTIVE",
  "plan": "internal"
}
```

**비고**: SaaS 멀티 테넌트 전환 시 이 레코드는 첫 번째 테넌트 레코드로 교체됨.  
`docs/saas-roadmap.md`의 Phase S-1 참조.

---

## H-3: Knowledge Base 초기 문서 ingestion

### H-3-1: KB 문서 생성

**Knowledge Base**: `aigo-kb` (ID: `BTLXQGMG9F`)  
**S3 버킷**: `aigo-kb`  
**리전**: `ap-northeast-2`

생성된 문서 9개 (`docs/kb/` 디렉터리):

| 파일 | 카테고리 | 토픽 | Data Source |
|------|----------|------|-------------|
| `infrastructure-standards/terraform-best-practices.md` | infrastructure_standards | terraform | aigo-ds-infrastructure |
| `infrastructure-standards/aws-iam-patterns.md` | infrastructure_standards | iam | aigo-ds-infrastructure |
| `infrastructure-standards/aws-lambda-ecs-patterns.md` | infrastructure_standards | compute | aigo-ds-infrastructure |
| `coding-standards/typescript-standards.md` | coding_standards | typescript | aigo-ds-coding |
| `coding-standards/python-agent-standards.md` | coding_standards | python | aigo-ds-coding |
| `security-policies/secret-detection.md` | security_policies | secrets | aigo-ds-security |
| `security-policies/web-security-policy.md` | security_policies | web_security | aigo-ds-security |
| `risk-policies/pr-risk-scoring.md` | risk_policies | pr_risk_scoring | aigo-ds-risk |
| `risk-policies/incident-response-policy.md` | risk_policies | incident_response | aigo-ds-risk |

각 `.md` 파일에 `.metadata.json` 사이드카 파일 동반 (Bedrock KB 메타데이터 필터링용):
```json
{ "metadataAttributes": { "category": "...", "topic": "..." } }
```

**S3 업로드 명령**:
```bash
aws s3 sync docs/kb/ s3://aigo-kb/ \
  --region ap-northeast-2 \
  --sse aws:kms
```

### H-3-2: Ingestion 시작

**KB concurrent ingestion 제한**: Data Source당 동시 1개 작업.  
KB 전체 기준으로 동시 실행 허용 여부는 미정 — 안전하게 순차 실행 권장.

| Data Source | DS ID | Job ID | 시작 방법 |
|---|---|---|---|
| aigo-ds-infrastructure | BGK6VYG2TC | RBHDQXH1AP | 직접 실행 |
| aigo-ds-risk | IWVBRHQDKW | VMZLG3IAAG | 직접 실행 |
| aigo-ds-coding | DZEEYC3BED | 0WVNDH6REL | 선행 2개 완료 후 실행 |
| aigo-ds-security | UXTKXGVM0F | B61CZTJN1V | coding 완료 후 실행 |

coding, security가 `ConflictException`으로 실패한 이유:  
infrastructure/risk 잡이 아직 실행 중인 상태에서 동시 시작 시도.

### H-3-3: Ingestion 완료 확인

최종 확인 (2026-06-11):

```
DATA_SOURCE      DS_ID        STATUS    DOCS
infrastructure   BGK6VYG2TC   COMPLETE  3
coding           DZEEYC3BED   COMPLETE  2
risk             IWVBRHQDKW   COMPLETE  2
security         UXTKXGVM0F   COMPLETE  2
```

총 **9개 문서**가 KB에 인덱싱됨.

**상태 확인 명령** (재실행 시 참고):
```bash
KB_ID="BTLXQGMG9F"
for DS_ID in BGK6VYG2TC DZEEYC3BED IWVBRHQDKW UXTKXGVM0F; do
  aws bedrock-agent list-ingestion-jobs \
    --region ap-northeast-2 \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --query "ingestionJobSummaries[0].[status,statistics.numberOfDocumentsScanned]" \
    --output text
done
```

---

## 재실행 가이드 (KB 재구축이 필요한 경우)

1. `docs/kb/` 문서 수정 또는 추가 후:
   ```bash
   aws s3 sync docs/kb/ s3://aigo-kb/ --region ap-northeast-2 --sse aws:kms
   ```
2. 변경된 Data Source만 선택적으로 ingestion 재시작:
   ```bash
   aws bedrock-agent start-ingestion-job \
     --region ap-northeast-2 \
     --knowledge-base-id BTLXQGMG9F \
     --data-source-id <DS_ID>
   ```
3. 상태 확인 후 COMPLETE 검증.
