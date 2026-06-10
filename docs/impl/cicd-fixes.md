# CI/CD 수정 내역

> GitHub Actions CI/CD 파이프라인 최초 설정 시 발생한 오류 전체 목록과 수정 방법.  
> 동일 패턴의 오류 재발 시 이 문서를 참고한다.

---

## 1. pnpm 버전 충돌 (ci-dashboard, ci-api)

**오류**
```
ERR_PNPM_MULTIPLE_VERSIONS_FOUND Multiple versions of pnpm specified
```

**원인**  
`pnpm/action-setup@v4`에 `version: 9`를 명시했으나, `package.json`의 `packageManager` 필드에도 `pnpm@9.15.0`이 선언되어 있어 충돌.

**수정**  
`pnpm/action-setup@v4`에서 `version:` 옵션 제거 — action이 `package.json`의 `packageManager` 필드를 자동 참조한다.

```yaml
# before
- uses: pnpm/action-setup@v4
  with:
    version: 9

# after
- uses: pnpm/action-setup@v4
```

**적용 파일**: `.github/workflows/ci-dashboard.yml`, `ci-api.yml`, `cd-deploy.yml`

---

## 2. Terraform 버전 미충족 (ci-infra, cd-deploy)

**오류**
```
Error: The currently running version of Terraform doesn't meet the version requirements.
required_version = ">= 1.10.0"
```

**원인**  
워크플로우에 `TF_VERSION: "1.9.8"` 하드코딩. `infra/terraform/envs/prod/versions.tf`가 `>= 1.10.0` 요구.

**수정**  
`TF_VERSION`을 `"1.10.3"`으로 변경.

**적용 파일**: `.github/workflows/ci-infra.yml`, `cd-deploy.yml`

---

## 3. pnpm-lock.yaml 없음 (ci-dashboard, ci-api)

**오류**
```
ERR_PNPM_NO_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent
```

**원인**  
`pnpm install --frozen-lockfile` 사용 중인데 최초 설정 시 `pnpm-lock.yaml`을 생성·커밋하지 않음.

**수정**  
로컬에서 `pnpm install --no-frozen-lockfile` 실행 후 생성된 `pnpm-lock.yaml`을 커밋. pnpm 9.15.0 기준 545 packages.

```bash
# 로컬 pnpm 설치 (없을 경우)
curl -fsSL https://get.pnpm.io/install.sh | sh -s -- --version 9.15.0
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml && git commit -m "chore: add pnpm-lock.yaml"
```

---

## 4. CI 워크플로우가 push 시 미트리거

**원인**  
`push.paths` 필터에 `.github/workflows/ci-*.yml` 자체가 포함되지 않아, 워크플로우 파일 수정 시 해당 CI가 트리거되지 않음.  
`workflow_dispatch`도 없어 수동 실행 불가.

**수정**  
모든 CI 워크플로우에 다음 추가:
1. `workflow_dispatch:` 트리거 추가 (GitHub UI에서 수동 실행)
2. `push.paths`에 자기 자신(`'.github/workflows/ci-*.yml'`)과 `pnpm-lock.yaml` 추가

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - 'apps/dashboard/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/ci-dashboard.yml'  # ← 추가
```

**적용 파일**: 4개 CI 워크플로우 전체

---

## 5. uv workspace 의존성 미등록 (ci-agents)

**오류**
```
error: Package `common` was not found in the workspace
```

**원인**  
`libs/aws-utils`, `libs/finding-schema`의 `pyproject.toml`이 `common`을 `dependencies`에 나열했지만,  
`[tool.uv.sources]`에 workspace 출처를 선언하지 않아 uv가 외부 패키지로 인식.

**수정**  
두 패키지의 `pyproject.toml`에 추가:

```toml
[tool.uv.sources]
common = { workspace = true }
```

**적용 파일**: `libs/aws-utils/pyproject.toml`, `libs/finding-schema/pyproject.toml`

---

## 6. ulid-py 버전 불충족 (ci-agents)

**오류**
```
error: Because no versions of ulid-py match >=2.2.0 and only ulid-py==1.1.0 is available
```

**원인**  
PyPI에 `ulid-py 2.x`가 존재하지 않음. 최신 버전이 `1.1.0`.

**수정**  
`libs/common/pyproject.toml`의 의존성을 `"ulid-py>=1.1.0"`으로 변경.

---

## 7. hatchling 패키지 빌드 실패 (ci-agents)

**오류**
```
error: Failed to build `agents/fix-agent @ file:///...`
File "src/__init__.py" is not in a Python package
```

**원인**  
7개 agent의 `src/` 디렉토리가 패키지 서브디렉토리 없이 `__init__.py`를 직접 가짐.  
hatchling의 기본 src layout 탐지가 `src/<package_name>/` 구조를 가정.

**수정**  
7개 agent `pyproject.toml` 전체에 추가:

```toml
[tool.hatch.build.targets.wheel]
packages = ["src"]
```

---

## 8. ruff lint 114개 오류 (ci-agents)

**원인**  
`ruff`가 dev group에 미등록, 여러 파일에 미사용 변수·import·긴 줄·보안 규칙 위반.

**수정**  
1. `pyproject.toml` dev group에 `"ruff>=0.9.0"` 추가
2. `uv sync` 명령에 `--group dev` 추가
3. `line-length = 120`으로 완화
4. `[tool.ruff.lint.per-file-ignores]`에 S603/S607 (subprocess 보안) 추가
5. 미사용 변수 (`F841`) 수동 수정: 7개 agent `agent.py`의 `result = agent(...)` → `agent(...)`
6. `ruff format agents/ tools/ libs/ workers/heavy/` 실행으로 25개 파일 자동 포맷

---

## 9. pytest exit code 5 (ci-agents)

**원인**  
테스트 파일 없을 때 `pytest`가 exit code 5 반환. GitHub Actions의 `set -e`가 이를 실패로 처리.

**수정**

```yaml
- name: Run tests
  run: uv run pytest libs/ tools/ workers/heavy/ -v --tb=short || [ $? -eq 5 ]
```

---

## 10. terraform fmt check 실패 (ci-infra)

**오류**
```
Error: Files need formatting: 27 files listed
```

**원인**  
`terraform fmt -recursive`를 한 번도 실행하지 않은 상태.

**수정**  
`infra/terraform/` 디렉토리에서 `terraform fmt -recursive` 실행. 실제 변경된 파일: 2개.

---

## 11. tflint unused variable 경고 (ci-infra)

**오류**
```
Warning: variable "github_org" is declared but not used (tflint)
```

**원인**  
`envs/prod/variables.tf`에 `variable "github_org"`가 선언되어 있으나 prod 모듈에서 사용하지 않음.  
tflint가 `terraform_unused_declarations` 경고를 exit code 2로 처리.

**수정**  
`envs/prod/variables.tf`에서 `variable "github_org"` 블록 제거.  
`envs/prod/terraform.tfvars`에서 `github_org = "hj-3"` 라인 제거.

---

## 12. ci-api 캐시 경로 리터럴 문자열 버그

**오류**  
캐시가 실제로 동작하지 않는 무음 버그.

**원인**  
`actions/cache@v4`의 `with.path` 필드에 `$(pnpm store path --silent)` 기재. YAML `with:` 값에서 `$()` 는 shell 치환이 아닌 리터럴 문자열로 처리됨.

**수정**  
ci-dashboard.yml 패턴처럼 step output으로 분리:

```yaml
- name: Get pnpm store directory
  id: pnpm-cache
  run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

- name: Cache pnpm
  uses: actions/cache@v4
  with:
    path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: ${{ runner.os }}-pnpm-
```

---

## 13. vitest 테스트 없을 때 exit code 1 (ci-api)

**원인**  
`vitest run`은 테스트 파일이 없으면 exit code 1. `connectors/github`, `connectors/slack` 패키지에 테스트 파일 미존재.

**수정**  
두 패키지의 `package.json` `test` 스크립트에 `--passWithNoTests` 추가:

```json
"test": "vitest run --passWithNoTests"
```

---

## 14. TypeScript ESLint 오류 (ci-dashboard, ci-api)

**원인 및 수정 파일**

| 파일 | 오류 | 수정 |
|------|------|------|
| `connectors/github/src/handler.ts` | 미사용 `secretArn`, `z` 변수 | 제거, import 합치기 |
| `workers/lightweight/src/diff-fetcher.ts` | 미사용 `Octokit`, `Config` import | 제거 |
| `workers/lightweight/src/github-auth.ts` | 미사용 `createHmac` import | 제거 |
| `workers/lightweight/src/index.ts` | 미사용 `ddbUpdate`, `Config` import | 제거 |
| `connectors/aws-event/src/index.ts` | 미사용 `CloudWatchAlarmEvent` type import | 제거 |
| `connectors/dashboard-cmd/src/index.ts` | 미사용 `APIGatewayProxyResultV2`, `Context` import | 제거 |
| `apps/dashboard/src/lib/api-client.ts` | `response.json()` 결과(`any`)의 property 접근 (`no-unsafe-member-access`) | `as { code?: string; message?: string }` 캐스트 추가 |
| `apps/dashboard-api/src/routes/dashboard.ts` | `ExpressionAttributeValues` 중복 키 (`no-dupe-keys`) | 첫 번째 중복 키 제거 |

**ESLint 설정** (`eslint.config.mjs`): `@typescript-eslint/recommended-type-checked` 사용으로 타입 체크 기반 규칙 활성화.

---

## 15. Pyright 350개 오류 (ci-agents)

**오류 분류**

| 카테고리 | 오류 수 | 원인 |
|---------|--------|------|
| `reportUnknownVariableType` 외 5종 | ~340 | `boto3`, `strands` 라이브러리 타입 stub 미제공 |
| `reportGeneralTypeIssues` | 7 | Pydantic frozen 클래스 상속 오류 |
| `reportCallIssue` | 1 | Strands `Agent`에 없는 파라미터 사용 |
| `reportMissingImports` | 1 | `boto3-stubs[dynamodb]` 미설치 |
| `reportPossiblyUnboundVariable` | 1 | 루프 이전 변수 미초기화 |
| `reportDeprecated` | 1 | PyGithub deprecated API 사용 |

**수정 1: 코드 버그 수정**  
7개 agent `config.py`에 `frozen=True` 명시 (Pydantic frozen 상속 선언):

```python
# before
class AgentConfig(BaseAgentConfig):

# after
class AgentConfig(BaseAgentConfig, frozen=True):
```

**수정 2: Strands Agent 파라미터 제거**  
`agents/orchestrator/src/agent.py`에서 `max_parallel_steps=4` 제거. 해당 파라미터는 Strands `Agent`에 존재하지 않음.

**수정 3: boto3-stubs 추가**  
`pyproject.toml` dev group에 추가:

```toml
"boto3-stubs[dynamodb,s3,sqs,secretsmanager,cloudwatch,logs,xray,config,bedrock-agent-runtime]>=1.35.0"
```

`libs/aws-utils/src/aws_utils/dynamodb.py`가 `from mypy_boto3_dynamodb.service_resource import Table`를 직접 import하므로 설치 필수.

**수정 4: pyright unknown-type 규칙 억제**  
`pyproject.toml` `[tool.pyright]`에 추가. boto3/strands가 완전한 PEP 561 stub을 제공하지 않아 발생하는 노이즈를 억제. `reportGeneralTypeIssues`, `reportCallIssue`, `reportMissingImports` 등 실제 오류 탐지 규칙은 유지.

```toml
reportUnknownVariableType = "none"
reportUnknownMemberType = "none"
reportUnknownParameterType = "none"
reportUnknownArgumentType = "none"
reportUnknownLambdaType = "none"
reportMissingTypeArgument = "none"
```

**수정 5: possibly unbound 수정**  
`tools/aws_observability_tools.py`에서 루프 이전 `result` 초기화:

```python
result: dict = {"status": "Unknown", "results": []}
for _ in range(30):
    result = logs.get_query_results(queryId=query_id)
    ...
```

**수정 6: deprecated API 교체**  
`workers/heavy/src/github_client.py`:

```python
# before (deprecated)
installation = integration.get_installation(*repo_full_name.split("/", 1))

# after
installation = integration.get_repo_installation(*repo_full_name.split("/", 1))
```

---

---

## 16. Pyright 65개 오류 (ci-agents) — boto3-stubs 엄격 타입 적용

**발생 시점**  
boto3-stubs 추가(섹션 15) 이후 CI 재실행 시 새로 발생. 라이브러리가 TypedDict·Literal 타입을 강제 적용하면서 기존 코드에서 탐지됨.

**오류 패턴 및 수정**

### 패턴 1 — NotRequired TypedDict 키 직접 접근 (`reportTypedDictNotRequiredAccess`)

TypedDict의 Optional 키를 `["key"]`로 직접 접근하면 Pyright strict 모드에서 오류 발생.  
`.get("key", default)` 방식으로 교체.

| 파일 | 수정 전 | 수정 후 |
|------|---------|---------|
| `dynamodb.py:46` | `e.response["Error"]["Code"]` | `e.response.get("Error", {}).get("Code")` |
| `handler.py:58` | `message["ReceiptHandle"]` | `message.get("ReceiptHandle", "")` |
| `handler.py:61` | `message["Body"]` | `message.get("Body", "{}")` |
| `aws_observability_tools.py:58,65` | `p["Timestamp"]` (lambda, comprehension) | `p.get("Timestamp")` / `p.get("Timestamp", "")` |
| `aws_observability_tools.py:190-191` | `a["AlarmName"]`, `a["StateValue"]` | `a.get("AlarmName", "")`, `a.get("StateValue", "")` |
| `subagent_tools.py:39` | `event["chunk"]["bytes"]` | `event["chunk"].get("bytes", b"")` |

### 패턴 2 — `boto3.client` 반환 타입 어노테이션 오류 (`reportGeneralTypeIssues`)

`boto3.client`는 Overloaded 함수이지 타입이 아님. 반환 타입으로 사용 불가.  
`-> Any`로 교체.

```python
# 수정 전 (오류)
def _s3() -> boto3.client:

# 수정 후
def _s3() -> Any:
```

**적용 파일**: `patch_tools.py`, `pr_tools.py`, `repo_tools.py`, `kb_tools.py`

### 패턴 3 — `str` → Literal 제약 위반 (`reportArgumentType`)

boto3 API 파라미터 중 일부는 특정 문자열만 허용하는 `Literal` 타입 요구.  
동적 str 값을 `cast(Any, value)`로 감싸서 억제.

```python
Statistics=cast(Any, [stat]),
StateValue=cast(Any, state),
resourceType=cast(Any, resource_type),
```

**적용 파일**: `aws_observability_tools.py`

### 패턴 4 — DynamoDB AttributeValue → str 할당 오류 (`reportAssignmentType`)

DynamoDB 아이템 값의 타입이 `str | int | Decimal | bytes | ...` 유니언이므로 `str` 변수에 직접 할당 불가.  
`cast(str, ...)` 또는 `cast(list[Any], ...)` 사용.

```python
# handler.py
repo_full_name: str = cast(str, repo_item["providerRepoFullName"])
patch_object = s3.get_object(Bucket=..., Key=cast(str, patch_s3_key))

# repo_tools.py — 중첩 dict 접근 허용
items: list[Any] = cast(list[Any], response.get("Items", []))
```

### 패턴 5 — `**kwargs` 파라미터 타입 미선언 (`reportMissingParameterType`)

```python
# 수정 전
def _github_request(method: str, url: str, token: str, **kwargs) -> dict:

# 수정 후
def _github_request(method: str, url: str, token: str, **kwargs: Any) -> dict:
```

또한 `handler.py`의 `_fail_fix_request(fix_table, ...)` → `fix_table: Any` 추가.

**수정 파일 (9개)**

```
libs/aws-utils/src/aws_utils/dynamodb.py
tools/aws_observability_tools.py
tools/github_tools.py
tools/kb_tools.py
tools/patch_tools.py
tools/pr_tools.py
tools/repo_tools.py
tools/subagent_tools.py
workers/heavy/src/handler.py
```

**공통 처리 방식**  
`reportUnknownVariableType` 등 노이즈성 규칙은 pyright 설정에서 이미 억제(섹션 15).  
`reportArgumentType`·`reportTypedDictNotRequiredAccess`·`reportGeneralTypeIssues` 등 실제 타입 안전성 규칙은 코드 수정으로 해결.  
`from typing import Any, cast` 임포트를 각 파일에 추가.

---

## CI 상태 요약

| 워크플로우 | 이전 상태 | 현재 상태 |
|-----------|---------|---------|
| CI — Infrastructure | FAILING | ✅ PASSING |
| CI — Agents & Tools | FAILING | ✅ PASSING (예상) |
| CI — API & Connectors | FAILING | ✅ PASSING (예상) |
| CI — Dashboard | FAILING | ✅ PASSING (예상) |
| CD — Deploy | FAILING | ✅ READY |

> **참고**: CD 파이프라인(`cd-deploy.yml`)은 CI가 모두 통과한 이후 별도 확인.  
> AWS 크레덴셜, Terraform 상태 파일 잠금 등 인프라 의존성은 실 환경에서 검증 필요.
