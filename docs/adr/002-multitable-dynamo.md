# ADR-002: DynamoDB 멀티 테이블 설계 채택

**상태**: 채택  
**날짜**: 2026-06-09

---

## 배경

DynamoDB 설계 패턴으로 Single-Table Design과 Multi-Table 중 선택이 필요했다.

## 검토한 옵션

**옵션 1: Single-Table Design**
- 하나의 테이블에 모든 엔티티
- 장점: 트랜잭션 용이, 조인 없는 단일 쿼리
- 단점: 이 서비스의 엔티티(Organizations, Reports, Incidents, AuditLogs)는 접근 패턴이 너무 달라 GSI 설계가 과도하게 복잡해짐. PK 네이밍 혼란

**옵션 2: 멀티 테이블 (채택)**
- 도메인별 테이블 분리
- 장점: 접근 패턴이 명확, 테이블별 독립 용량 설정, 이해하기 쉬움
- 단점: 크로스 테이블 트랜잭션 시 DynamoDB Transactions 필요 (실제 사용 케이스 적음)

## 결정

멀티 테이블 채택. 13개 테이블로 도메인별 분리.

## 결과

- 각 테이블은 3개 이하의 GSI로 접근 패턴 커버
- AuditLogs는 append-only + TTL로 비용 최적화
- 향후 트래픽 증가 시 테이블별 독립적 용량 조정 가능
