# Slack App 추가 설정 런북

> `deploy-runbook.md` Phase C (앱 생성·스코프·설치·토큰 발급) 이후에 필요한 추가 설정.
> 이 문서에 없는 내용은 `deploy-runbook.md` C-2, C-3, E를 참조.

---

## 현재 완료된 항목 (deploy-runbook.md 기준)

- [x] Slack App 생성 (`AgentOps`)
- [x] Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`
- [x] Install to Workspace → `xoxb-...` 발급
- [x] `aigo/slack` Secrets Manager에 `botToken`, `signingSecret` 저장
- [x] `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` Lambda 환경 변수 설정

---

## 추가 설정 1 — OAuth Redirect URL 등록

온보딩의 "Slack 연결하기" 버튼은 OAuth 2.0 플로우를 통해 per-org 봇 토큰을 SSM에 저장합니다.
이를 위해 Redirect URL 등록이 필요합니다.

1. [api.slack.com/apps](https://api.slack.com/apps) → 앱 선택
2. **OAuth & Permissions** → **Redirect URLs** → **Add New Redirect URL**
3. 아래 URL 입력 후 **Save URLs**:

```
https://api.seolphung.com/auth/slack/callback
```

> 이 설정이 없으면 Slack이 `redirect_uri_mismatch` 에러를 반환합니다.

---

## 추가 설정 2 — 다른 채널/워크스페이스에 봇 추가 (Manage Distribution)

현재 봇은 설치된 **1개 워크스페이스**에서만 동작합니다.
배포 설정을 활성화하면 온보딩 OAuth 흐름을 통해 다른 워크스페이스에도 추가가 가능합니다.

1. **Settings → Manage Distribution**
2. 하단 체크리스트 항목을 모두 완료
3. **Activate Public Distribution** 클릭

> 이 설정 없이는 `/oauth/v2/authorize` URL이 `not_allowed` 에러를 반환합니다.

### 현재 워크스페이스에서 다른 채널에 봇 추가하는 방법

- **공개 채널**: `chat:write.public` 스코프가 이미 부여되어 있으므로 초대 없이 바로 메시지 전송 가능
- **비공개 채널**: 해당 채널 내에서 `/invite @AIGO Bot` 실행

---

## 추가 설정 3 — Slash Command URL 설정 (미완료)

`/approve`, `/reject`, `/investigate` 명령어 수신 Lambda는 배포되어 있으나
Slack App에 URL이 등록되지 않은 상태입니다.

1. **Slash Commands** → 각 커맨드 **Edit**

   | 커맨드 | Request URL |
   |--------|-------------|
   | `/approve` | `https://api.seolphung.com/slack/commands` |
   | `/reject` | `https://api.seolphung.com/slack/commands` |
   | `/investigate` | `https://api.seolphung.com/slack/commands` |

2. **Interactivity & Shortcuts** → **Interactivity** 활성화 → **Request URL**:

```
https://api.seolphung.com/slack/events
```

3. **Save Changes**

> 이 설정이 완료되어야 Slack 채널에서 `/approve <reportId>` 등의 명령이 동작합니다.

---

## 알림 채널 설정

봇 알림이 전송될 채널을 설정합니다.

**옵션 A — 조직별 채널 (권장):**
대시보드 → 설정 → 알림 설정 → **Slack 기본 채널** 입력 (예: `#aigo-alerts`)

**옵션 B — 전역 기본값:**
Orchestrator Lambda에 환경 변수 추가:

```bash
aws lambda update-function-configuration \
  --function-name aigo-orchestrator \
  --environment "Variables={SLACK_CHANNEL_ID=C0XXXXXXXXX}" \
  --region ap-northeast-2
```

> 채널 ID는 Slack에서 채널 우클릭 → "채널 세부정보 보기" → 하단에서 확인 (`C0XXXXXXX` 형식).
