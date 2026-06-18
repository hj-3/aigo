# KB 벡터 검색 — S3 + Titan Embeddings v2

## 비용 비교

| 방식 | 구성 | 월 비용 | 비고 |
|------|------|---------|------|
| **Bedrock KB + AOSS** | AOSS 4 OCU + Bedrock KB 인제스션 | **$700~750/월** | OCU pause 불가 — idle 상태에도 4 OCU 고정 과금 |
| **S3 Vector KB** | S3 (JSON index) + Titan Embeddings 쿼리 | **$1~3/월** | 스토리지 < 1MB, 쿼리 ~50/일 기준 |

### AOSS 비용 상세

```
인덱싱 OCU: 2 × $0.24/h × 730h = $350/월
검색  OCU: 2 × $0.24/h × 730h = $350/월
합계 = ~$700/월 (문서 없어도 동일)
```

AOSS는 **일시 중지가 불가능**하다. 컬렉션을 생성하면 삭제하기 전까지 24시간 과금된다.

### S3 Vector KB 비용 상세

```
S3 스토리지: ~1MB (index.json) = $0.00002/월
GET 요청: Lambda cold start시 1회 = $0.0000004
Titan Embeddings v2: $0.00002/1K tokens
  → 쿼리 1회 ≈ 50 tokens = $0.000001
  → 분석 1회 ≈ 4회 쿼리 = $0.000004
  → 하루 50 PR = $0.0002/일 = ~$0.006/월

합계 ≈ $0.01/월 (실질적으로 무료)
```

---

## 아키텍처

```
[오프라인 빌드 (1회)]
  docs/kb/**/*.md
    → Chunk (2400자, 20% 오버랩)
    → Titan Embeddings v2 (1024차원)
    → s3://aigo-kb/vector-index/index.json

[Lambda 런타임]
  kb_tools.search_coding_standards("query")
    → /tmp에 캐시된 index.json 없으면 S3에서 다운로드
    → Titan Embeddings v2로 쿼리 임베딩
    → 코사인 유사도 계산 (pure Python, 1024×N)
    → top-5 청크 반환 (relevance ≥ 0.5 필터)
```

**캐싱:** Lambda 컨테이너 생존 기간 동안 index는 메모리에 캐시됨.  
**인덱스 크기:** 50청크 × (1024 floats + 2400자) ≈ 700KB JSON.

---

## 구현 파일

| 파일 | 역할 |
|------|------|
| `tools/kb_tools.py` | S3 벡터 검색 tool functions |
| `scripts/build-kb-index.py` | 오프라인 인덱스 빌더 |
| `infra/terraform/envs/prod/main.tf` | `KB_BUCKET`, `KB_INDEX_KEY` env vars |
| `infra/terraform/global/iam/main.tf` | Titan Embeddings InvokeModel 권한 |

---

## 최초 인덱스 구축 절차

```bash
# 1. 의존성 설치
pip install boto3

# 2. AWS 인증 확인
aws sts get-caller-identity

# 3. 인덱스 빌드 및 S3 업로드
python scripts/build-kb-index.py

# 완료 시 출력 예시:
#   chunked docs/kb/coding-standards/typescript-standards.md: 3 chunk(s)
#   chunked docs/kb/security-policies/web-security-policy.md: 2 chunk(s)
#   ...
#   Uploaded (684.3 KB)
#   Done. Index: s3://aigo-kb/vector-index/index.json — 18 chunks, 684.3 KB
```

**주의:** 처음 실행 시 Titan Embeddings 호출이 20~30회 발생하므로 약 60초 소요.

---

## KB 문서 업데이트 시 재빌드

```bash
# KB 문서 변경 후 인덱스 재빌드
python scripts/build-kb-index.py

# Orchestrator Lambda는 자동으로 새 인덱스를 사용
# (캐시 TTL 3600초 — 다음 cold start 또는 1시간 후 적용)
```

---

## Terraform 변경 내역

`BEDROCK_KB_ID` → 삭제  
`KB_BUCKET`, `KB_INDEX_KEY` → 추가 (양쪽 Lambda — lambda_common_env + orchestrator)

```hcl
# lambda_common_env에 추가
KB_BUCKET    = module.s3.bucket_names["kb"]
KB_INDEX_KEY = "vector-index/index.json"

# orchestrator Lambda env에도 추가
KB_BUCKET    = module.s3.bucket_names["kb"]
KB_INDEX_KEY = "vector-index/index.json"
```

### IAM 변경 (global/iam/main.tf)

```hcl
# BedrockInvokeModel Resource에 추가
"arn:aws:bedrock:*::foundation-model/amazon.titan-embed-*"
```

---

## 이전 방식 (Bedrock KB + AOSS) 비교

| 항목 | Bedrock KB + AOSS | S3 Vector KB |
|------|-------------------|--------------|
| 인덱싱 | 자동 (KB 인제스션 작업) | 수동 빌드 스크립트 |
| 검색 | Bedrock Retrieve API | 코사인 유사도 (Python) |
| 확장성 | 수백만 문서 처리 가능 | ~수천 문서 적합 |
| 정확도 | 동일 (Titan Embeddings 사용) | 동일 |
| 월 비용 | $700 | $1 미만 |
| 설정 복잡도 | AOSS 컬렉션, KB, 데이터소스, 인제스션 | S3 JSON 파일 1개 |

AgentOps KB는 현재 ~10개 문서 (<100 청크) 규모이므로 S3 Vector 방식이 최적.
