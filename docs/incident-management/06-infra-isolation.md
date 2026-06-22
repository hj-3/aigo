# AIGO Incident Management — 인프라 격리 전략

## 핵심 원칙

**이미 존재하는 인프라는 절대 중복 생성하지 않는다.**

IM Terraform은 세 가지 범주로 리소스를 다룬다.

| 범주 | 설명 | Action |
|------|------|--------|
| **자동 상속** | 동일 VPC/서브넷에 Lambda를 배치하면 그냥 쓰인다 | 별도 선언 없음 |
| **data source 참조** | CM이 소유하는 네임드 리소스를 이름·alias로 조회 | `data "aws_*"` 블록 |
| **신규 생성** | IM에만 존재해야 하는 리소스 | `resource "aws_*"` 블록 |

---

## Terraform State 분리

```
S3 버킷: aigo-tf-state (기존, CM과 동일 버킷)

Change Management   →  key: prod/terraform.tfstate            (기존)
Incident Management →  key: services/im/prod/terraform.tfstate (신규)
```

두 state는 완전히 독립. `terraform_remote_state` 참조 없음 — state 간 결합도 0.

---

## 1. 자동 상속 (선언 불필요)

Lambda 함수를 CM과 동일한 프라이빗 서브넷에 배치하면 아래 인프라가 별도 설정 없이 동작한다.

### Gateway VPC Endpoints (S3, DynamoDB)

VPC 모듈이 이미 생성한 리소스:

```
aigo-vpce-s3        — com.amazonaws.ap-northeast-2.s3        (Gateway, Free)
aigo-vpce-dynamodb  — com.amazonaws.ap-northeast-2.dynamodb  (Gateway, Free)
```

Gateway Endpoint는 VPC 전체의 프라이빗 라우트 테이블에 등록된다.
IM Lambda도 동일한 프라이빗 서브넷에 배치되므로 **자동으로 DynamoDB·S3 트래픽이 VPC 내부를 통해 라우팅**된다.
→ IM Terraform에서 별도 `aws_vpc_endpoint` 생성 불필요. 새로 생성하면 오류.

### NAT Gateway

단일 NAT Gateway(`aigo-nat-ap-northeast-2a`)가 이미 존재하며,
프라이빗 서브넷의 기본 라우트(`0.0.0.0/0`)가 이 NAT로 향한다.
IM Lambda의 외부 API 호출(Bedrock, STS, CloudWatch 등)도 **자동으로 이 NAT를 경유**한다.
→ IM Terraform에서 NAT Gateway 및 EIP 생성 불필요.

---

## 2. data source 참조

CM이 소유하는 리소스. IM은 이름·tag·alias로 조회만 한다.

```hcl
# ── VPC ────────────────────────────────────────────────────────────────────────
data "aws_vpc" "main" {
  tags = {
    Project     = "aigo"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
}

# ── Security Group (기존 Lambda SG 재사용) ──────────────────────────────────────
data "aws_security_group" "lambda" {
  name   = "aigo-lambda-sg"
  vpc_id = data.aws_vpc.main.id
}

# ── KMS Keys (CM이 생성한 키를 IM 리소스 암호화에 재사용) ──────────────────────────
data "aws_kms_alias" "lambda" {
  name = "alias/aigo-lambda"   # Lambda 환경변수 암호화
}

data "aws_kms_alias" "dynamodb" {
  name = "alias/aigo-dynamodb" # IM DynamoDB 테이블 암호화
}

data "aws_kms_alias" "s3" {
  name = "alias/aigo-s3"       # IM S3 reports 버킷 암호화
}

# ── S3 artifacts 버킷 (IM Lambda 코드 패키지 업로드) ──────────────────────────────
data "aws_s3_bucket" "artifacts" {
  bucket = "aigo-artifacts"    # CM Lambda 코드와 동일 버킷, prefix만 다르게 사용
}

# ── Cognito (im-api API Gateway Authorizer 설정) ────────────────────────────────
data "aws_cognito_user_pools" "main" {
  name = "aigo-user-pool"
}

# ── Route53 Zone (im-api.seolphung.com 레코드 추가) ────────────────────────────
data "aws_route53_zone" "main" {
  name         = "seolphung.com."
  private_zone = false
}

# ── ACM 인증서 (*.seolphung.com 와일드카드 — im-api.seolphung.com 커버됨) ─────────
data "aws_acm_certificate" "regional" {
  domain      = "seolphung.com"
  statuses    = ["ISSUED"]
  most_recent = true
}

# ── SES Identity (noreply@seolphung.com 장애보고서 발신) ────────────────────────
data "aws_ses_domain_identity" "main" {
  domain = "seolphung.com"
}
```

### 요약 테이블

| 리소스 | CM 리소스명 | IM에서의 역할 |
|--------|------------|--------------|
| VPC | `aigo-vpc` | Lambda VPC 배치 |
| Private Subnets | `aigo-private-ap-northeast-2{a,b,c}` | Lambda subnet_ids |
| Lambda Security Group | `aigo-lambda-sg` | Lambda security_group_ids |
| KMS Lambda Key | `alias/aigo-lambda` | IM Lambda 환경변수 암호화 |
| KMS DynamoDB Key | `alias/aigo-dynamodb` | IM DynamoDB 테이블 암호화 |
| KMS S3 Key | `alias/aigo-s3` | IM reports S3 버킷 암호화 |
| S3 artifacts | `aigo-artifacts` | IM Lambda .zip 코드 업로드 (`lambda/im-*/latest.zip`) |
| Cognito User Pool | `aigo-user-pool` | API Gateway Cognito Authorizer |
| Route53 Zone | `seolphung.com` | `im-api.seolphung.com` A 레코드 추가 |
| ACM 인증서 | `*.seolphung.com` SAN | API GW regional certificate |
| SES Identity | `seolphung.com` | `noreply@seolphung.com` 보고서 이메일 |

---

## 3. 신규 생성 (IM 전용)

IM에서만 사용하는 리소스. CM Terraform과 완전히 별개.

```hcl
# ── API Gateway ────────────────────────────────────────────────────────────────
resource "aws_api_gateway_rest_api" "im" {
  name = "aigo-im-api"
  tags = local.common_tags
}

resource "aws_api_gateway_domain_name" "im" {
  domain_name              = "im-api.seolphung.com"
  regional_certificate_arn = data.aws_acm_certificate.regional.arn
  endpoint_configuration { types = ["REGIONAL"] }
  tags = local.common_tags
}

resource "aws_route53_record" "im_api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "im-api.seolphung.com"
  type    = "A"
  alias {
    name                   = aws_api_gateway_domain_name.im.regional_domain_name
    zone_id                = aws_api_gateway_domain_name.im.regional_zone_id
    evaluate_target_health = false
  }
}

resource "aws_api_gateway_authorizer" "cognito" {
  name          = "aigo-im-cognito-authorizer"
  rest_api_id   = aws_api_gateway_rest_api.im.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [tolist(data.aws_cognito_user_pools.main.arns)[0]]
}

# ── EventBridge Bus (IM 전용 — CM의 aigo-bus와 분리) ──────────────────────────
resource "aws_cloudwatch_event_bus" "im" {
  name = "aigo-im-event-bus"
  tags = local.common_tags
}

# ── Step Functions ─────────────────────────────────────────────────────────────
resource "aws_sfn_state_machine" "investigation" {
  name     = "aigo-im-investigation"
  role_arn = aws_iam_role.sfn.arn
  definition = templatefile("${path.module}/sfn-definition.json", {
    supervisor_arn = aws_lambda_function.im_supervisor.arn
  })
  tags = local.common_tags
}

# ── S3 reports 버킷 (IM 장애보고서 전용, CM의 aigo-reports와 별개) ──────────────
resource "aws_s3_bucket" "im_reports" {
  bucket = "aigo-im-reports-${local.account_id}"
  tags   = local.common_tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "im_reports" {
  bucket = aws_s3_bucket.im_reports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = data.aws_kms_alias.s3.target_key_arn
    }
  }
}

# ── DynamoDB × 11 (aigo-im-* 네임스페이스) ────────────────────────────────────
resource "aws_dynamodb_table" "incidents" {
  name         = "aigo-im-Incidents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_alias.dynamodb.target_key_arn
  }

  # ... 나머지 GSI, attribute 정의 (03-data-model.md 참조)
  tags = local.common_tags
}
# aigo-im-InvestigationResults, aigo-im-Reports, aigo-im-RecoveryActions,
# aigo-im-InvestigationTargets, aigo-im-ExternalIntegrations,
# aigo-im-LinkedAccounts, aigo-im-AllowedActions, aigo-im-RemediationSettings,
# aigo-im-SecurityEvents, aigo-im-Conversations — 동일 패턴

# ── Lambda × 10 (aigo-im-* 네임스페이스, CM의 aigo-artifacts 버킷 사용) ─────────
resource "aws_lambda_function" "im_api" {
  function_name = "aigo-im-api"
  handler       = "dist/index.handler"
  runtime       = "nodejs22.x"
  role          = aws_iam_role.im_api.arn
  s3_bucket     = data.aws_s3_bucket.artifacts.id    # 기존 버킷 재사용
  s3_key        = "lambda/im-api/latest.zip"          # prefix만 다름
  kms_key_arn   = data.aws_kms_alias.lambda.target_key_arn

  vpc_config {
    subnet_ids         = data.aws_subnets.private.ids
    security_group_ids = [data.aws_security_group.lambda.id]
  }

  environment {
    variables = {
      INCIDENTS_TABLE = aws_dynamodb_table.incidents.name
      IM_REPORTS_BUCKET = aws_s3_bucket.im_reports.id
      SFN_ARN         = aws_sfn_state_machine.investigation.arn
      SES_FROM        = "noreply@seolphung.com"
      COGNITO_USER_POOL_ID = tolist(data.aws_cognito_user_pools.main.ids)[0]
    }
  }

  tags = local.common_tags
}
# 나머지 9개 Lambda도 동일 패턴 (s3_bucket = data.aws_s3_bucket.artifacts.id)

# ── IAM Roles × 10 (Lambda별 최소 권한) ────────────────────────────────────────
resource "aws_iam_role" "im_api" {
  name               = "aigo-im-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags
}
```

### 신규 생성 리소스 목록

| 리소스 | 이름 | 비고 |
|--------|------|------|
| API Gateway REST API | `aigo-im-api` | |
| API GW Custom Domain | `im-api.seolphung.com` | 기존 ACM 인증서 재사용 |
| Route53 A Record | `im-api.seolphung.com` | 기존 Zone에 레코드 추가 |
| EventBridge Bus | `aigo-im-event-bus` | CM의 `aigo-bus`와 별개 |
| Step Functions | `aigo-im-investigation` | |
| S3 버킷 | `aigo-im-reports-{accountId}` | 장애보고서 전용 |
| DynamoDB 테이블 × 11 | `aigo-im-*` | KMS는 기존 `alias/aigo-dynamodb` 재사용 |
| Lambda × 10 | `aigo-im-*` | 코드는 기존 `aigo-artifacts` 버킷 저장 |
| IAM Role × 10 | `aigo-im-*-role` | Lambda별 최소 권한 |
| EventBridge Rules × 4 | CloudWatch/Health/GuardDuty 트리거 | |

---

## Terraform Backend 설정

```hcl
# services/incident-management/infra/terraform/envs/prod/backend.tf
terraform {
  backend "s3" {
    bucket         = "aigo-tf-state"
    key            = "services/im/prod/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "aigo-tf-locks"
    encrypt        = true
  }
}
```

`aigo-tf-state` 버킷과 `aigo-tf-locks` 테이블은 CM이 소유. key만 다르게 지정.

---

## 리소스 태깅

```hcl
locals {
  account_id = data.aws_caller_identity.current.account_id
  common_tags = {
    Project     = "aigo"
    Product     = "IncidentManagement"   # CM은 ChangeManagement
    ManagedBy   = "terraform"
    Environment = "prod"
  }
}
```

---

## 배포 독립성 확인

| 항목 | Change Management | Incident Management |
|------|-------------------|---------------------|
| Terraform state | `prod/terraform.tfstate` | `services/im/prod/terraform.tfstate` |
| Terraform 실행 위치 | `infra/terraform/envs/prod/` | `services/incident-management/infra/terraform/envs/prod/` |
| API Gateway | `api.seolphung.com` | `im-api.seolphung.com` |
| Lambda 네임스페이스 | `aigo-*` | `aigo-im-*` |
| DynamoDB 네임스페이스 | `aigo-*` | `aigo-im-*` |
| EventBridge Bus | `aigo-bus` | `aigo-im-event-bus` |
| S3 코드 버킷 | `aigo-artifacts` (소유) | `aigo-artifacts` (참조만) |
| S3 보고서 버킷 | `aigo-reports` (CM 보고서) | `aigo-im-reports-{accountId}` (IM 전용) |
| KMS Key | `alias/aigo-*` (소유) | `alias/aigo-*` (참조만) |
| Product 태그 | `ChangeManagement` | `IncidentManagement` |
| CI/CD 워크플로 | `cd-deploy.yml` | `im-deploy.yml` (신규) |

```bash
# IM 독립 배포
cd services/incident-management/infra/terraform/envs/prod
terraform init   # services/im/prod/ state 초기화
terraform plan   # CM 리소스는 data source로만 읽음
terraform apply  # CM 인프라에 영향 없음
```
