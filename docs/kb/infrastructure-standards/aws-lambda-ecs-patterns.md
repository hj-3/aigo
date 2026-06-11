# AWS Lambda & ECS Best Practices

## Lambda Configuration
- Timeout: set to the minimum needed + 20% buffer; never set to 900 unless justified
- Memory: start at 256 MB; profile with Lambda Power Tuning for cost-optimal sizing
- Reserved concurrency: set for critical functions to prevent throttling cascades
- Environment variables: non-sensitive config only; secrets via Secrets Manager at runtime
- Layers: shared dependencies only; avoid layers that are updated more than once per week

## Lambda SQS Integration
- `visibility_timeout` on SQS queue must be >= 6 × Lambda `timeout`
- `batch_size = 1` for critical jobs (easier error handling, simpler DLQ analysis)
- `FunctionResponseTypes: ["ReportBatchItemFailures"]` to avoid reprocessing entire batch
- DLQ must be configured — never lose messages silently

## Lambda Deployment
- Always publish versions (`--publish` flag) for production functions
- Use aliases (`live`, `canary`) for traffic shifting and rollback
- Canary deployment: 10% → monitor for 60s → promote or rollback
- Never delete old versions while alias still points to them

## ECS Fargate Patterns
- Use `FARGATE_SPOT` for batch/non-critical workloads (up to 70% cost savings)
- Task role: minimal permissions scoped to the specific workload
- `networkMode: awsvpc` with private subnets + VPC endpoints for AWS services
- RunTask (not Service) pattern for on-demand heavy workers — avoid idle container cost
- Log driver: `awslogs` with log group per task family; retention = 14–30 days

## Cost Optimization
- Lambda: right-size memory; ARM (Graviton2) reduces cost by ~20%
- ECS: Fargate Spot for batch jobs; reserve on-demand capacity only for SLAs
- SQS: FIFO only when ordering is required (higher cost); standard queue otherwise
- CloudWatch Logs: always set log retention (never "never expire")

## Observability
- X-Ray tracing: enable on Lambda and ECS tasks for distributed tracing
- Structured logs: JSON format with `requestId`, `orgId`, `correlationId` fields
- Custom metrics: emit `AnalysisJobDuration`, `AgentRunErrors` for SLA monitoring
- Alarm: error rate > 1% on Lambda → PagerDuty alert

## Common Infrastructure Findings
- Lambda timeout > SQS visibility_timeout → messages reprocessed, duplicate jobs
- Missing DLQ on SQS → message loss on processing failure
- ECS task with `privileged: true` → HIGH severity security finding
- Lambda with `ROLLBACK_ON_FAILURE: false` on SQS → silent message loss
- Missing `ReservedConcurrencyLimit` on webhook connector → potential DDoS amplification
