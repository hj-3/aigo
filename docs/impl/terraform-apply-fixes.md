# Terraform Apply 오류 수정 내역

> envs/prod 최초 배포 시 발생한 오류 전체 목록과 수정 방법.  
> 동일 패턴의 오류 재발 시 이 문서를 참고한다.

---

## 1. IAM EntityAlreadyExists

**오류**
```
EntityAlreadyExists: Role aigo-github-actions-deploy already exists
```

**원인**  
`global/iam`에서 이미 생성한 IAM Role, OIDC Provider를 `envs/prod`에서 다시 `module "iam"`으로 재생성 시도.

**수정**  
`envs/prod/main.tf`에서 `module "iam"` 블록 전체를 제거하고 `data "terraform_remote_state"`로 교체.

```hcl
# before
module "iam" {
  source = "../../modules/iam"
  ...
}

# after
data "terraform_remote_state" "iam" {
  backend = "s3"
  config = {
    bucket = "aigo-tf-state"
    key    = "global/iam/terraform.tfstate"
    region = "ap-northeast-2"
  }
}
```

이후 `module.iam.*` 참조 9곳을 `data.terraform_remote_state.iam.outputs.*`로 일괄 교체.

---

## 2. API Gateway JWT audience 빈 배열

**오류**  
JWT Authorizer의 `audience`가 빈 배열(`[]`)로 설정되어 인증 불가.

**원인**  
`modules/api-gateway`에 `cognito_client_id` 변수가 없어 `audience = []`로 하드코딩.

**수정**

`modules/api-gateway/variables.tf`에 변수 추가:
```hcl
variable "cognito_client_id" { type = string }
```

`modules/api-gateway/main.tf`에서:
```hcl
# before
audience = []

# after
audience = [var.cognito_client_id]
```

`envs/prod/main.tf`에서 모듈 호출 시 전달:
```hcl
cognito_client_id = module.cognito.client_id
```

---

## 3. CloudWatch KMS AccessDenied

**오류**
```
AccessDenied: logs.amazonaws.com is not authorized to use key
```

**원인**  
KMS key policy의 CloudWatch Logs principal을 글로벌 엔드포인트(`logs.amazonaws.com`)로 지정. CloudWatch Logs는 리전별 principal이 필요.

**수정** (`modules/kms/main.tf`)
```hcl
# before
Principal = { Service = "logs.amazonaws.com" }

# after
Principal = { Service = "logs.${var.aws_region}.amazonaws.com" }
```

`modules/kms/variables.tf`에 `aws_region` 변수 추가.  
`envs/prod/main.tf` kms 모듈 호출 시 `aws_region = var.aws_region` 전달.

---

## 4. CloudTrail KMS 권한 없음

**오류**
```
AccessDenied: cloudtrail.amazonaws.com not authorized to use key
```

**원인**  
CloudWatch KMS key policy에 CloudTrail service principal이 없었음.

**수정** (`modules/kms/main.tf`) — cloudwatch key policy에 statement 추가:
```hcl
{
  Sid    = "Allow CloudTrail"
  Effect = "Allow"
  Principal = { Service = "cloudtrail.amazonaws.com" }
  Action    = ["kms:GenerateDataKey*", "kms:Decrypt"]
  Resource  = "*"
  Condition = {
    StringLike = {
      "kms:EncryptionContext:aws:cloudtrail:arn" = "arn:aws:cloudtrail:${var.aws_region}:${var.aws_account_id}:trail/*"
    }
  }
}
```

---

## 5. S3 버킷 이미 존재

**오류**
```
BucketAlreadyOwnedByYou: aigo-tf-state already exists
```

**원인**  
Phase A에서 수동으로 생성한 `aigo-tf-state` 버킷을 `modules/s3`의 `buckets` map에서 다시 생성 시도.

**수정** (`modules/s3/main.tf`) — `locals.buckets`에서 `tf_state` 항목 제거.

---

## 6. WAF description 특수문자

**오류**
```
InvalidParameterException: invalid description
```

**원인**  
`modules/security/main.tf`의 WAF Web ACL description에 em dash(`—`, U+2014) 사용. AWS는 ASCII 범위만 허용.

**수정**
```hcl
# before
description = "WAF for API Gateway — managed rules + rate limiting"

# after
description = "WAF for API Gateway - managed rules + rate limiting"
```

---

## 7. CloudFront InvalidViewerCertificate

**오류**
```
InvalidViewerCertificate: To use an alternate domain, you must specify an ACM certificate
```

**원인**  
`domain_name`만 설정하고 `acm_certificate_arn`이 없는 경우에도 `aliases` 설정을 시도.

**수정** (`modules/cloudfront/main.tf`)
```hcl
# before
aliases = var.domain_name != "" ? ["app.${var.domain_name}"] : null

# after
aliases = (var.domain_name != "" && var.acm_certificate_arn != "") ? ["app.${var.domain_name}"] : null
```

---

## 8. CloudFront 로그 버킷 ACL 오류

**오류**
```
AccessControlListNotSupported: The bucket does not allow ACLs
```

**원인**  
CloudFront 액세스 로그를 S3 버킷에 쓰려면 `BucketOwnerPreferred` ownership + `log-delivery-write` ACL 필요.

**수정** (`modules/s3/main.tf`) — logs 버킷에 리소스 추가:
```hcl
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.buckets["logs"].id
  rule { object_ownership = "BucketOwnerPreferred" }
}

resource "aws_s3_bucket_acl" "logs" {
  bucket     = aws_s3_bucket.buckets["logs"].id
  acl        = "log-delivery-write"
  depends_on = [aws_s3_bucket_ownership_controls.logs]
}
```

---

## 9. S3 Object Lock 생성 후 설정 불가

**오류**
```
InvalidBucketState: Object Lock configuration cannot be enabled on existing buckets
```

**원인**  
Object Lock은 버킷 생성 시에만 활성화 가능. 이미 생성된 버킷에 `aws_s3_bucket_object_lock_configuration`을 추가하면 오류.

**수정** (`modules/s3/main.tf`) — `aws_s3_bucket_object_lock_configuration.logs` 리소스 제거, versioning으로 대체.

---

## 10. Lambda 로그 그룹 중복 생성

**오류**
```
ResourceAlreadyExistsException: The specified log group already exists
```

**원인**  
`modules/lambda`와 `modules/monitoring` 두 곳에서 동일한 `/aws/lambda/{fn_name}` 로그 그룹을 생성.

**수정** (`modules/lambda/main.tf`)  
`aws_cloudwatch_log_group.this` 리소스 전체 제거. `modules/monitoring`이 단독으로 생성.  
`modules/lambda/outputs.tf`에서 `log_group_name` output도 제거.

---

## 11. WAF + HTTP API v2 연동 불가

**오류**
```
WAFInvalidParameterException: AWS::ApiGateway::Stage is the only resource type supported
```

**원인**  
WAF WebACL Association은 REST API(v1) Stage만 지원. 이 프로젝트는 HTTP API(v2) 사용.

**수정** (`envs/prod/main.tf`)
```hcl
api_gateway_arn = ""  # 빈 문자열로 WAF 연결 스킵
```

`modules/security/main.tf`에서:
```hcl
resource "aws_wafv2_web_acl_association" "api_gateway" {
  count = var.api_gateway_arn != "" ? 1 : 0
  ...
}
```

---

## 12. CloudTrail InvalidEventSelectorsException

**오류**
```
InvalidEventSelectorsException: Invalid S3 ARN: arn:aws:s3:::aigo-
```

**원인**  
CloudTrail S3 data event selector에 불완전한 ARN(`arn:aws:s3:::aigo-`) 사용.

**수정** (`modules/security/main.tf`) — S3 data events 제거, management events만 유지:
```hcl
event_selector {
  read_write_type           = "All"
  include_management_events = true
}
```

---

## 13. AOSS 인덱스 자동 생성 403

**오류**
```
{"status":403,"error":{"reason":"403 Forbidden","type":"Forbidden"}}
```

**원인**  
Terraform `null_resource` local-exec 안에서 수동으로 구현한 SigV4 서명 코드가 지속적으로 403 반환. 정확한 원인 미확정 (IAM 권한 또는 서명 구현 문제로 추정).

**수정**  
`null_resource.create_kb_index` 전체를 Terraform에서 제거. 별도 Python 스크립트로 분리.

`infra/scripts/create-aoss-index.py` 생성 — boto3 + requests-aws4auth 사용:
```bash
python3 -m venv /tmp/aoss-venv
/tmp/aoss-venv/bin/pip install boto3 requests requests-aws4auth -q
/tmp/aoss-venv/bin/python3 infra/scripts/create-aoss-index.py
```

**배포 순서 변경** (2단계):
1. `terraform apply` → AOSS collection 생성 (KB는 실패)
2. 위 스크립트 실행 → index 생성
3. `terraform apply` → Bedrock KB 생성 완료

---

## 14. AOSS Data Access Policy principal 형식 오류

**오류**
```
ValidationException: does not match the regex pattern ^arn:...:iam::\d{12}:(user|role)/[\w+=,.@-]{1,64}$
```

**원인**  
AOSS Data Access Policy는 `role/*`, `user/*` 와일드카드 ARN 미지원.

**허용 형식:**
- `arn:aws:iam::ACCOUNT:root`
- `arn:aws:iam::ACCOUNT:user/이름`
- `arn:aws:iam::ACCOUNT:role/이름`
- `arn:aws:sts::ACCOUNT:assumed-role/역할/세션`

**수정** (`modules/bedrock-kb/main.tf`) — 정확한 ARN을 동적으로 계산하는 local 사용:
```hcl
data "aws_caller_identity" "current" {}

locals {
  _caller_arn = data.aws_caller_identity.current.arn
  deploy_principal = strcontains(local._caller_arn, ":assumed-role/") ? (
    "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${split("/", local._caller_arn)[1]}"
  ) : local._caller_arn
}

# access policy Principal
Principal = [
  aws_iam_role.bedrock_kb.arn,
  local.deploy_principal
]
```

STS assumed-role 세션 ARN(`arn:aws:sts::ACCOUNT:assumed-role/ROLE/SESSION`)을 IAM role ARN으로 정규화하는 로직. IAM user로 실행 시에는 그대로 사용.

---

## 15. Lambda 예약 환경변수 AWS_REGION

**오류**
```
InvalidParameterValueException: Reserved keys used in this request: AWS_REGION
```

**원인**  
Lambda가 자동으로 주입하는 예약 환경변수를 `lambda_common_env`에 직접 포함.  
Lambda 예약 키: `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_EXECUTION_ENV`, `AWS_LAMBDA_*` 등.

**수정** (`envs/prod/main.tf`) — `lambda_common_env`에서 `AWS_REGION` 줄 제거:
```hcl
locals {
  lambda_common_env = {
    STAGE                 = "prod"
    # AWS_REGION 제거 — Lambda 자동 주입
    DYNAMODB_TABLE_PREFIX = var.project
    ...
  }
}
```

---

## 16. Lambda S3 NoSuchKey (초기 배포)

**오류**
```
InvalidParameterValueException: S3 Error Code: NoSuchKey
```

**원인**  
Lambda 함수 생성 시 `s3_bucket`/`s3_key`로 지정한 배포 패키지가 S3에 없음.  
최초 인프라 배포 시 CI/CD가 아직 코드를 업로드하지 않은 상태.

**수정**  
placeholder zip을 수동으로 생성해 S3에 업로드:

```bash
# placeholder 생성
mkdir -p /tmp/lambda-placeholder
cat > /tmp/lambda-placeholder/index.js << 'EOF'
exports.handler = async (event) => {
  return { statusCode: 200, body: JSON.stringify({ message: 'placeholder' }) };
};
EOF

python3 -c "
import zipfile, os
os.chdir('/tmp/lambda-placeholder')
with zipfile.ZipFile('/tmp/placeholder.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('index.js')
"

# S3 업로드 (7개 함수)
for key in \
  lambda/github-connector/latest.zip \
  lambda/slack-connector/latest.zip \
  lambda/dashboard-cmd-connector/latest.zip \
  lambda/aws-event-connector/latest.zip \
  lambda/dashboard-api/latest.zip \
  lambda/lightweight-worker/latest.zip \
  lambda/notification-worker/latest.zip
do
  aws s3 cp /tmp/placeholder.zip "s3://aigo-artifacts/${key}"
done
```

이후 Phase G에서 CI/CD가 실제 코드로 덮어씌움.

---

---

## 17. deploy-agent.sh 오류 수정 내역

### 17-1. uv 명령어 not found

**오류**
```
uv: command not found
```

**원인**  
`uv`가 `/home/ubuntu/.local/bin/uv`에 설치되어 있으나 PATH에 없음.

**수정**  
스크립트 실행 시 PATH 주입:
```bash
PATH="$HOME/.local/bin:$PATH" ./scripts/deploy-agent.sh <agent-name>
```

---

### 17-2. s3 cp --server-side-encryption 플래그 오류

**오류**
```
Unknown options: --server-side-encryption, aws:kms
```

**원인**  
`aws s3 cp`의 서버측 암호화 플래그는 `--sse`이며 `--server-side-encryption`은 유효하지 않음.

**수정** (`scripts/deploy-agent.sh`)
```bash
# before
--server-side-encryption aws:kms

# after
--sse aws:kms
```

---

### 17-3. update-agent 후 스크립트가 멈추는 현상

**증상**  
`Updating agent instruction` 출력 후 응답 없이 멈춤.

**원인**  
`aws bedrock-agent update-agent` 명령이 느리고, `--output json` 기본값으로 AWS CLI pager(less)가 열려 인터랙티브 입력 대기.

**수정**  
`--no-cli-pager` 플래그를 모든 `bedrock-agent` 명령에 추가, verbose 출력은 `> /dev/null`으로 억제.

---

### 17-4. create-agent-version API 미존재

**오류**
```
Invalid choice: create-agent-version
'AgentsforBedrock' object has no attribute 'create_agent_version'
```

**원인**  
`CreateAgentVersion` API는 현재 boto3 1.43.26 및 AWS CLI 2.34.41에서 공개 제공되지 않음. Terraform provider가 내부적으로만 사용하는 API.

**확인된 대안**:
- `POST /agents/{id}/agentversions/` → 200 (목록 반환, 생성 아님)
- `PUT /agents/{id}/agentversions/` → 403 Unauthorized
- 별도 alias에 DRAFT 라우팅 시도 → 400 ("DRAFT must not be associated with this alias")

**수정**  
deploy-agent.sh에서 version 생성 및 alias 업데이트 단계 제거. 스크립트는 instruction 업데이트 + prepare-agent(DRAFT 상태 전환)만 수행.

버전 생성 및 alias 갱신은 Terraform으로 관리:
```bash
# prompts/v1/*.md 변경 후 terraform apply → v2 생성 + alias 자동 갱신
cd infra/terraform/envs/prod
terraform apply
```

**배경**: Terraform `aws_bedrockagent_agent` provider가 `prepare_agent = true`일 때 내부적으로 `CreateAgentVersion`을 호출하여 버전을 생성함. 이 API는 공개 SDK/CLI에 노출되어 있지 않음.

---

### 17-5. 현재 배포 상태 정리

| Agent | Agent ID | Alias ID | 현재 alias 버전 | DRAFT 상태 |
|---|---|---|---|---|
| code-reviewer | ZPXOLSCMQ8 | 5RVXQWZ56C | v1 | PREPARED |
| infra-reviewer | 1VT8TLY6IQ | 0PMXRWADTJ | v1 | PREPARED |
| risk-reviewer | (SSM 조회) | (SSM 조회) | v1 | PREPARED |
| security-agent | (SSM 조회) | (SSM 조회) | v1 | PREPARED |
| incident-agent | (SSM 조회) | (SSM 조회) | v1 | PREPARED |
| fix-agent | (SSM 조회) | (SSM 조회) | v1 | PREPARED |
| orchestrator | (SSM 조회) | (SSM 조회) | v1 | PREPARED |

- v1: Terraform 최초 apply 시 생성됨. instruction은 `prompts/v1/*.md` 전체 내용.
- alias는 v1을 가리키며 정상 서비스 중.
- DRAFT에도 동일 instruction이 업데이트됨 (deploy-agent.sh 실행 결과).

---

## 참고: terraform init 재실행 필요한 경우

`required_providers`를 추가하거나 제거한 경우 `terraform init`을 재실행해야 한다.

이번 배포에서 발생한 케이스:
- `hashicorp/null` 추가 → `terraform init` 필요
- `hashicorp/null` 제거 (null_resource 삭제 후) → `terraform init` 필요
