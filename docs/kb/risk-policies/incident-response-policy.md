# Incident Response and Root Cause Analysis Policy

## Incident Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|-----------|---------------|------------|
| SEV-1 | Complete service outage or data loss in progress | Immediate | On-call + management |
| SEV-2 | Partial outage or major feature unavailable | < 15 min | On-call engineer |
| SEV-3 | Degraded performance or non-critical feature down | < 1 hour | Assigned engineer |
| SEV-4 | Minor issue, workaround available | Next business day | Ticket only |

## Automated Incident Detection Sources
- CloudWatch Alarm: error rate > threshold triggers SEV-2 or SEV-3
- CloudTrail: unauthorized API call patterns trigger SEV-2
- GuardDuty finding of HIGH severity triggers SEV-1 or SEV-2
- DLQ message accumulation (> 100 messages) triggers SEV-3
- ECS task exit code non-zero pattern triggers SEV-3

## Root Cause Analysis (RCA) Framework

### Investigation Checklist
1. **Timeline construction**: identify exact start time from CloudWatch metrics
2. **Recent changes**: check deployments and config changes in the 24 hours before incident
3. **Error pattern**: identify error type (5xx rate, timeout, throttle, auth failure)
4. **Blast radius**: identify affected services, organizations, and user count
5. **Correlation**: cross-reference CloudTrail, X-Ray traces, and application logs
6. **Contributing factors**: infrastructure, code, configuration, or external dependency

### Common Root Cause Categories
- **Deployment**: regression introduced in recent release → check git log, rollback candidate
- **Infrastructure**: resource limit (Lambda concurrency, RDS connections) → check CloudWatch
- **Dependency**: external API (GitHub, Slack) degraded → check provider status page
- **Data**: unexpected input pattern, malformed record in DynamoDB → check DLQ contents
- **Configuration**: missing environment variable, wrong ARN, expired secret → check Lambda config
- **Capacity**: traffic spike exceeding reserved concurrency → check Lambda throttle metric

### RCA Report Required Sections
1. Incident summary (1 paragraph, non-technical)
2. Timeline with timestamps
3. Root cause (specific, not "human error")
4. Contributing factors
5. Impact assessment (users affected, data at risk, duration)
6. Immediate remediation actions taken
7. Long-term preventive actions with owners and due dates

## Post-Incident Actions
- Rollback: if deployment-related, revert within 15 minutes of confirmation
- Fix forward: if rollback is not safe (DB migration applied), fix forward with hotfix PR
- Communication: update status page within 30 minutes of SEV-1/SEV-2 detection
- Postmortem: required for all SEV-1 and SEV-2 incidents, within 5 business days
- Blameless culture: postmortems focus on systems and processes, not individuals

## Agent-Assisted Investigation Scope
The DevOps Incident Agent may query:
- CloudWatch Logs Insights (time-bounded to incident window)
- CloudWatch Metrics (CPU, memory, error rate, latency)
- X-Ray trace summaries (not full trace bodies to limit cost)
- CloudTrail events (API calls in the affected time window)
- Recent git commits and deployment records from DynamoDB
The agent must NOT: modify resources, restart services, or make API calls to GitHub or Slack.
