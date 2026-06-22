# AIGO Incident Management — 서비스 개요

## 목적

CloudWatch 알람·외부 모니터링 툴에서 감지된 인시던트를 AI가 자동 조사하고, 장애보고서를 생성하며, 승인된 조치를 순차 실행합니다. 조사 대상 등록부터 조치 실행까지 단일 대시보드에서 완결됩니다.

---

## 대시보드 탭 구조 (7개)

```
Incident Management
  ├── 조사 대상 설정     조사할 AWS 알람 / 외부 도구 등록
  │     ├── AWS 서비스   CloudWatch 알람 등록
  │     └── 외부 도구   Zabbix, Prometheus, Grafana 연동
  │
  ├── 인시던트 조사      발생한 인시던트 목록 + AI 조사 결과 + 장애보고서
  ├── 조치 현황          조치 방안 목록 + 순차 실행
  ├── 리소스 진단        AI 채팅으로 특정 리소스 진단 요청
  ├── 보안 이벤트        계정 침해·유출 인시던트 + 대응 플레이북
  ├── 모니터링           CloudWatch 메트릭 현황
  └── 관리
        ├── 계정 관리    Linked Account 등록 (멀티 계정)
        └── 자동 조치 설정  AllowList / All 모드 설정
```

---

## 탭별 기능 요약

### 조사 대상 설정

**AWS 서비스 탭**
- "알람 등록" 버튼 → AWS 서비스 선택 + CloudWatch 알람 선택 → 등록
- 등록된 알람이 ALARM 상태로 전환될 때만 인시던트 조사 시작
- 등록하지 않은 알람은 무시 (전체 알람이 아닌 선별 조사)

**외부 도구 탭**
- "연동 추가" 버튼 → Zabbix / Prometheus / Grafana 선택 → Webhook URL + API Key 발급
- 발급된 Webhook URL을 외부 툴에 등록하면 알람 발생 시 자동 전달
- 연동된 툴 목록과 상태(활성/비활성) 확인

### 인시던트 조사
- 등록된 조사 대상에서 인시던트 발생 시 자동 조사 시작
- 목록: 계정 / 발생 시각 / 서비스 / 알람명 / 근본 원인 / 트리거 / 상태
- 클릭 → 조사 결과 상세 (근본 원인, 영향 범위, 타임라인)
- **장애보고서 버튼**: 외부 공유용 한국어 보고서 생성 (S3 저장 + 이메일)
- **Mitigation Plan 버튼**: 조치 방안 생성 → 조치 현황 탭에 등록

### 조치 현황
- 인시던트별 조치 방안 목록 확인
- 상세 내용(조치 항목, 위험도, 예상 소요 시간) 확인 후 "실행" 버튼으로 순차 수행
- 관리 탭의 AllowList/All 모드에 따라 실행 가능 여부 결정

### 리소스 진단
- 진단할 서비스 선택 (EC2, RDS, Lambda 등)
- AI 채팅으로 진단 요청: "최근 7일 메모리 사용 패턴 분석해줘"
- 채팅 결과 + 진단 보고서 출력

### 보안 이벤트
- GuardDuty 탐지 / CloudTrail 이상 징후 → 계정 침해·유출 인시던트 표시
- 인시던트별 대응 플레이북 확인 (단계별 보안 대응 절차)
- 일반 인시던트(장애)와 분리 관리

### 모니터링
- 등록된 조사 대상 서비스들의 CloudWatch 메트릭 실시간 현황

### 관리

**계정 관리 탭**
- "계정 추가" 버튼 → AWS Account ID + Cross-Account IAM Role ARN 등록
- 등록된 Linked Account의 인시던트도 동일하게 조사·조치 가능
- 계정별 상태 및 권한 확인

**자동 조치 설정 탭**
- **AllowList 모드**: 하단 허용 액션 목록에서 Enable된 것만 실행 가능
- **All 모드**: 등록 여부 관계없이 모든 AWS API 액션 실행 가능 (고위험)
- 각 허용 액션: 서비스, 오퍼레이션, 위험도, 활성화 토글

---

## Input 경로 요약

| 입력 소스 | 전달 방식 | 처리 Lambda |
|-----------|---------|------------|
| CloudWatch Alarm (등록된 것만) | EventBridge → aigo-im-event-bus | normalize_event |
| AWS Health Event | EventBridge → aigo-im-event-bus | normalize_event |
| Zabbix / Prometheus / Grafana | HTTP Webhook → API GW | webhook_receiver |
| GuardDuty Finding | EventBridge (aws.guardduty) | security_event_handler |
| CloudTrail 이상 징후 | EventBridge (aws.cloudtrail) | security_event_handler |

---

## Change Management와 격리

| 항목 | Change Management | Incident Management |
|------|-----------------|---------------------|
| 코드 | github-connector, orchestrator 등 | aigo-im-* Lambda |
| DDB 테이블 | aigo-Reports, Findings 등 | aigo-im-* 테이블 |
| EventBridge | aigo-bus | aigo-im-event-bus |
| 태그 | Product=ChangeManagement | Product=IncidentManagement |
| 공유 | Cognito, API GW, VPC, AuditLogs |
