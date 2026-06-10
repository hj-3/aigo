# ADR-003: ECS Fargate RunTask 방식 채택 (상시 Service 아님)

**상태**: 채택  
**날짜**: 2026-06-09

---

## 배경

Heavy Worker(repo clone, test, patch 생성)의 실행 방식을 결정해야 했다.

## 검토한 옵션

**옵션 1: ECS Service (상시 실행)**
- 워커가 항상 떠 있고 SQS 메시지를 폴링
- 장점: 빠른 응답, 워밍업 불필요
- 단점: 사용 없을 때도 비용 발생. 분석 요청이 burst 패턴이므로 비효율

**옵션 2: Lambda (긴 타임아웃)**
- Lambda 최대 15분 타임아웃 사용
- 단점: repo clone + 테스트는 15분을 초과할 수 있음. 로컬 파일시스템 용량 제한 (512MB)

**옵션 3: ECS Fargate RunTask (채택)**
- SQS 메시지 → Lambda dispatcher → ECS RunTask 호출
- 필요할 때만 Task 실행, 완료 후 자동 종료
- 장점: 비용 효율 (실행 시간만 과금), 파일시스템 제한 없음, 실행 시간 제한 없음
- 단점: 콜드스타트 20~60초 → SQS 비동기 처리로 사용자 체감 없음

## 결정

옵션 3 채택. lightweight-worker Lambda가 heavy 작업 감지 시 ECS RunTask API를 호출한다.

## 결과

- 분석 요청 없는 시간에 비용 발생 없음
- 작업 시간 제한 없음 (대형 레포도 처리 가능)
- 3 AZ에 걸쳐 Task 실행 → AZ 장애 시 다른 AZ에서 재실행
