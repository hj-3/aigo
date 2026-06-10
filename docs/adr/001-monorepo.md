# ADR-001: 혼합 언어 모노레포 채택

**상태**: 채택  
**날짜**: 2026-06-09  
**결정자**: 아키텍처팀

---

## 배경

TypeScript(커넥터·API·대시보드)와 Python(Agent·Tool·Worker)이 공존하는 서비스에서 레포 구조를 어떻게 가져갈지 결정이 필요했다.

## 검토한 옵션

**옵션 1: 언어별 멀티레포**
- TypeScript 레포, Python 레포 분리
- 장점: 언어별 빌드 독립성
- 단점: Agent·Tool·Schema 공유 어려움, 버전 동기화 복잡, CI/CD 분산 관리

**옵션 2: 단일 언어 (TypeScript only)**
- Agent도 TypeScript로 구현
- 단점: Strands Agents SDK가 Python 네이티브. TypeScript 바인딩 성숙도 낮음

**옵션 3: 혼합 언어 모노레포 (채택)**
- pnpm workspace (TypeScript) + uv workspace (Python) 공존
- 장점: 타입·스키마 공유, 통합 CI, 버전 일관성
- 단점: 빌드 도구 복잡도 증가 → path-based CI로 해소

## 결정

옵션 3 채택. 구체적으로:
- TypeScript: `apps/`, `connectors/`, `workers/lightweight/`, `packages/`
- Python: `agents/`, `tools/`, `workers/heavy/`, `libs/`
- pnpm workspace + uv workspace 병렬 운영

## 결과

- Finding, Report 스키마는 `packages/types/` (TS) + `libs/finding-schema/` (Python)으로 언어별 관리
- CI는 path filter로 변경된 언어 컴포넌트만 실행
- 의존성 그래프가 레포 내에서 명확
