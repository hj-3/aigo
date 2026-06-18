"""
Orchestrator Agent — Single Strands Agent with Multi-Persona analysis.

Flow (PR_ANALYSIS):
  0. Create GitHub Check Run → signal analysis started
  1. Retrieve repo/developer memory → contextual history
  2. For SELECTED personas only: search KB → analyze diff → save_findings
     Personas selected based on diff file types (classify_personas)
  3. Compute Risk Score (0-100) → save_report
  4. Update GitHub Check Run with conclusion
  5. notify_analysis_complete (per-org Slack) → post_pr_comment (with risk_score)
  6. save_pr_analysis_memory → persist learning for future PRs

Flow (INCIDENT):
  0. Retrieve incident memory for the affected service
  1. invoke_devops_agent → RCA report
  2. save_incident_memory → persist for future incidents
  3. send_incident_update → Slack notification
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

ORCHESTRATOR_SYSTEM_PROMPT = """You are AIGO — the AI Change Management Agent for the AgentOps Platform.

## Your Role
You analyze Pull Request changes from 4 expert perspectives (personas). You are a single agent
that switches analysis focus — not 4 separate agents. All analysis happens in one coherent flow.

## Persona 1: Code Reviewer
Detect in changed lines only:
- Bug patterns: null/undefined dereferences, swallowed exceptions, off-by-one errors
- Race Conditions and TOCTOU vulnerabilities
- N+1 database query patterns, unbounded loops
- Hardcoded secrets, API keys, passwords
- API breaking changes (removed fields, changed types)
- Missing error propagation, missing boundary validation
- Test coverage gaps for changed code

## Persona 2: Infrastructure Reviewer
Detect in IaC files (*.tf, *.yaml, Dockerfile, *.json CFN) only:
- IAM wildcard actions or resources (least-privilege violations)
- Security Groups with 0.0.0.0/0 on sensitive ports
- Missing encryption (S3, DynamoDB, SQS, EBS)
- Missing reliability features (no PITR, no DLQ, no Multi-AZ)
- Data retention policy violations (infinite log retention)
- Cost impact of new resources

## Persona 3: Security Agent
Detect security vulnerabilities (OWASP Top 10 / CWE):
- A01 Broken Access Control: missing authz checks, IDOR
- A02 Cryptographic Failures: weak algorithms, unencrypted sensitive data
- A03 Injection: SQL injection, command injection, template injection
- A04-A10: CSRF, misconfiguration, vulnerable components, auth failures, SSRF
- Hardcoded credentials (CRITICAL regardless of whether they appear real)

## Persona 4: Risk Reviewer
Assess deployment and business risk:
- API breaking changes (removed endpoints, changed schemas, new required params)
- Database schema changes without migration/rollback
- Blast radius: how many services/users are impacted
- Rollback complexity: EASY (git revert) | MEDIUM | HARD (data transformation needed)
- Deployment coordination requirements

## Analysis Tools
- search_coding_standards(query) — KB: coding standards, past code incidents
- search_infrastructure_standards(query) — KB: AWS Well-Architected, infra policies
- search_security_standards(query) — KB: security policies, OWASP guidelines
- search_risk_policies(query) — KB: change management policies, past risk incidents

## Risk Score Formula (0–100)
sum = (CRITICAL_count × 25) + (HIGH_count × 10) + (MEDIUM_count × 3) + (LOW_count × 1)
risk_score = min(sum, 100)

## Risk Level Thresholds
- 0–20:  LOW      → APPROVE
- 21–50: MEDIUM   → REQUEST_CHANGES
- 51–80: HIGH     → REQUEST_CHANGES
- 81–100: CRITICAL → BLOCK

## GitHub Check Run Conclusion Mapping
- LOW/APPROVE → success
- MEDIUM/REQUEST_CHANGES → neutral
- HIGH/REQUEST_CHANGES → action_required
- CRITICAL/BLOCK → action_required

## Execution Rules
1. In Step 0c you MUST decide which personas to run — state your decision explicitly before starting analysis
2. Only run the personas you declared in Step 0c — save time and tokens by skipping irrelevant ones
3. Only flag issues in CHANGED lines (additions in the diff) — never flag unchanged code
4. Never fabricate findings — only report what you genuinely detect in the diff
5. Always pass org_id and installation_id when calling Slack/GitHub tools
6. Complete ALL steps in the pipeline — never stop early
7. For skipped personas, do NOT call save_findings — omit them entirely

## Persona Selection Criteria
- **Code Reviewer**: ALWAYS run — every PR has code implications
- **Infra Reviewer**: Run ONLY when diff contains *.tf, *.hcl, Dockerfile, docker-compose*, helm/, k8s/, kubernetes/, *.yaml/.yml in infra/config directories
- **Security Agent**: Run for all code changes; SKIP only for pure documentation PRs (all files are *.md, *.txt, *.rst)
- **Risk Reviewer**: Run for all code changes; SKIP only for pure documentation PRs
"""

INCIDENT_SYSTEM_PROMPT = """You are AIGO — the DevOps Incident Response Orchestrator.

When an incident occurs, you coordinate investigation using the DevOps Agent (OODA Loop methodology):
1. Retrieve past incident memories to identify patterns
2. Invoke the DevOps Incident Agent with full context
3. Save the RCA result to incident memory
4. Send Slack notification with investigation results

You NEVER modify infrastructure directly. Investigation and reporting only.
"""


def build_agent(system_prompt: str = ORCHESTRATOR_SYSTEM_PROMPT) -> Agent:
    config = get_config()

    model_kwargs: dict = {
        "model_id": config.model_id,
        "region_name": config.aws_region,
        "max_tokens": 8192,
        "temperature": 0.0,
    }
    if config.guardrail_id:
        model_kwargs["guardrail_config"] = {
            "guardrailIdentifier": config.guardrail_id,
            "guardrailVersion": config.guardrail_version,
            "trace": "enabled",
        }

    model = BedrockModel(**model_kwargs)

    from tools import ddb_tools, github_tools, kb_tools, slack_tools, subagent_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=system_prompt,
        tools=[
            # KB search — used before each persona analysis
            kb_tools.search_coding_standards,
            kb_tools.search_infrastructure_standards,
            kb_tools.search_security_standards,
            kb_tools.search_risk_policies,
            # Persistence
            ddb_tools.save_report,
            ddb_tools.save_findings,
            ddb_tools.update_job_status,
            ddb_tools.update_incident,
            # Memory — retrieve history before analysis, save results after
            ddb_tools.get_repo_memory,
            ddb_tools.get_developer_memory,
            ddb_tools.save_pr_analysis_memory,
            ddb_tools.get_incident_memory,
            ddb_tools.save_incident_memory,
            # GitHub Check Run + merge
            github_tools.create_check_run,
            github_tools.update_check_run,
            github_tools.post_pr_comment,
            github_tools.auto_merge_pr,
            # Notifications
            slack_tools.notify_analysis_complete,
            slack_tools.send_incident_update,
            # Incident sub-agent
            subagent_tools.invoke_devops_agent,
        ],
    )


def run_analysis(job_input: dict[str, Any]) -> dict[str, Any]:
    """Entry point called by lambda_handler.handler. Routes to PR analysis or incident."""
    job_id = job_input["jobId"]
    org_id = job_input.get("orgId", "")
    repo_id = job_input.get("repoId", "")
    job_type = job_input.get("jobType", "PR_ANALYSIS")
    log = logger.bind(job_id=job_id, org_id=org_id, repo_id=repo_id, job_type=job_type)
    log.info("Orchestrator starting")

    if job_type == "INCIDENT":
        return _run_incident(job_input, log)
    return _run_pr_analysis(job_input, log)


def _run_pr_analysis(job_input: dict[str, Any], log: Any) -> dict[str, Any]:
    job_id = job_input["jobId"]
    org_id = job_input.get("orgId", "")
    repo_id = job_input.get("repoId", "")
    installation_id = job_input.get("installationId", "")

    diff_content = job_input.pop("diffContent", "")
    job_input_json = json.dumps(job_input)

    pr_ctx = job_input.get("prContext", {})
    diff_meta = job_input.get("diffMetadata", {})
    head_sha = pr_ctx.get("headSha", "")
    pr_number = pr_ctx.get("prNumber", 0)
    pr_url = pr_ctx.get("prUrl", "")
    repo_full_name = pr_ctx.get("repoFullName", repo_id)
    author_login = pr_ctx.get("authorLogin", "")
    dashboard_url = "https://app.seolphung.com"

    changed_files: list[str] = diff_meta.get("changedFiles", [])

    log.info(
        "Orchestrator PR analysis — starting",
        pr_number=pr_number,
        changed_files=len(changed_files),
        diff_chars=len(diff_content),
    )

    agent = build_agent()

    prompt = f"""Analyze Pull Request #{pr_number} — {pr_ctx.get("prTitle", "")}.
Repository: {repo_full_name} | Author: {author_login}
Branch: {pr_ctx.get("headBranch", "")} → {pr_ctx.get("baseBranch", "")}
Files changed: {len(changed_files)} (+{diff_meta.get("additions", 0)} / -{diff_meta.get("deletions", 0)})
Head SHA: {head_sha}
Installation ID: {installation_id}
Org ID: {org_id}

## Changed Files
{chr(10).join(f"  - {f}" for f in changed_files[:60])}

## PR Diff
```diff
{diff_content[:25000]}
```

## Job Context
{job_input_json}

---

### Step 0 — GitHub Check Run (signal analysis started)
Call create_check_run(
  repo_full_name="{repo_full_name}",
  head_sha="{head_sha}",
  installation_id="{installation_id}"
)
Save the returned check_run_id.

### Step 0b — Retrieve History
0b-1. Call get_repo_memory(org_id="{org_id}", repo_id="{repo_id}", limit=3)
0b-2. Call get_developer_memory(org_id="{org_id}", author_login="{author_login}", limit=5)

### Step 0c — Persona Selection (YOUR DECISION — state explicitly before proceeding)
Based on the Changed Files list above, decide which analysis personas are needed:
- Code Reviewer: needed for ANY code changes
- Infra Reviewer: needed ONLY if diff contains *.tf, *.hcl, Dockerfile, docker-compose, helm/, k8s/ files
- Security Agent: needed for all non-documentation changes
- Risk Reviewer: needed for all non-documentation changes

State your decision in this format:
"PERSONAS SELECTED: Code Reviewer, [Infra Reviewer,] Security Agent, Risk Reviewer"
"PERSONAS SKIPPED: [Infra Reviewer — no IaC files detected]"

Then execute ONLY the steps for personas you selected.

---
Run the following steps FOR EACH SELECTED PERSONA (skip steps for unselected personas):

### [IF Code Reviewer selected] — Code Review
1a. Call search_coding_standards("code quality bug patterns race condition null check error handling test coverage")
1b. Analyze the diff as Code Reviewer. Identify all genuine issues in CHANGED lines only.
1c. Call save_findings(job_id="{job_id}", agent_name="code-reviewer", findings=[list of finding dicts])
    Each finding: {{"severity":"CRITICAL|HIGH|MEDIUM|LOW|INFO", "category":"...", "location":"file:line", "description":"...", "confidence":0.0-1.0, "fixable":true|false, "fix_suggestion":"..."}}

### [IF Infra Reviewer selected] — Infrastructure Review
2a. Call search_infrastructure_standards("AWS IAM terraform security encryption well-architected reliability cost")
2b. Analyze the diff as Infra Reviewer. Only flag IaC files.
2c. Call save_findings(job_id="{job_id}", agent_name="infra-reviewer", findings=[...])

### [IF Security Agent selected] — Security Analysis
3a. Call search_security_standards("OWASP injection authentication secrets vulnerabilities CWE")
3b. Analyze the diff as Security Agent. Check OWASP Top 10 categories in changed lines.
3c. Call save_findings(job_id="{job_id}", agent_name="security-agent", findings=[...])

### [IF Risk Reviewer selected] — Risk Assessment
4a. Call search_risk_policies("API breaking changes deployment risk rollback blast radius change management")
4b. Analyze the diff as Risk Reviewer. Assess deployment blast radius and rollback complexity.
4c. Call save_findings(job_id="{job_id}", agent_name="risk-reviewer", findings=[...])

---

### Step 5 — Compute Score and Save Report
5a. Count all findings from selected persona steps by severity.
5b. risk_score = min((CRITICAL×25) + (HIGH×10) + (MEDIUM×3) + (LOW×1), 100)
5c. risk_level: 0-20→LOW, 21-50→MEDIUM, 51-80→HIGH, 81-100→CRITICAL
5d. merge_recommendation: LOW→APPROVE, MEDIUM/HIGH→REQUEST_CHANGES, CRITICAL→BLOCK
5e. Call save_report(
      job_id="{job_id}",
      org_id="{org_id}",
      repo_id="{repo_id}",
      risk_level=<determined>,
      risk_score=<integer 0-100>,
      merge_recommendation=<determined>,
      summary="<2-3 sentence summary, mention which personas were selected and key findings>",
      findings_by_severity={{"CRITICAL": N, "HIGH": N, "MEDIUM": N, "LOW": N, "INFO": N}},
      pr_number={pr_number},
      pr_url="{pr_url}",
      pr_title="{pr_ctx.get('prTitle', '')}",
      commit_sha="{pr_ctx.get('commitSha', head_sha)}",
      author_login="{author_login}"
    )
    Save the returned report_id.

### Step 6 — Update GitHub Check Run
Call update_check_run(
  repo_full_name="{repo_full_name}",
  check_run_id=<check_run_id from Step 0>,
  conclusion=<"success" if LOW, "neutral" if MEDIUM, "action_required" if HIGH/CRITICAL>,
  output_title="<N Critical, N High, N Medium findings>",
  output_summary="<summary from Step 5>",
  installation_id="{installation_id}"
)

### Step 7 — Slack Notification
Call notify_analysis_complete(
  job_id="{job_id}",
  org_id="{org_id}",
  repo_name="{repo_full_name}",
  pr_number={pr_number},
  pr_url="{pr_url}",
  risk_level=<from step 5>,
  risk_score=<from step 5>,
  merge_recommendation=<from step 5>,
  findings_summary=<findings_by_severity dict>,
  report_url="{dashboard_url}/reports/<report_id from step 5>"
)

### Step 8 — GitHub PR Comment
Call post_pr_comment(
  repo_full_name="{repo_full_name}",
  pr_number={pr_number},
  risk_level=<from step 5>,
  risk_score=<from step 5>,
  merge_recommendation=<from step 5>,
  summary=<summary from step 5>,
  findings_by_severity=<dict from step 5>,
  report_id=<report_id from step 5>,
  installation_id="{installation_id}"
)

### Step 8b — Auto-merge (if applicable)
Call auto_merge_pr(
  repo_full_name="{repo_full_name}",
  pr_number={pr_number},
  org_id="{org_id}",
  risk_score=<risk_score from step 5>,
  merge_recommendation=<merge_recommendation from step 5>,
  installation_id="{installation_id}"
)
The tool checks org.approvalRequired and org.riskThreshold before merging.
If approvalRequired=True or risk_score > threshold, it skips merge (returns a message — do not retry).
If APPROVE and below threshold, it merges the PR automatically.

### Step 9 — Save Analysis Memory
Call save_pr_analysis_memory(
  org_id="{org_id}",
  repo_id="{repo_id}",
  repo_full_name="{repo_full_name}",
  pr_number={pr_number},
  author_login="{author_login}",
  risk_score=<from step 5>,
  risk_level=<from step 5>,
  findings_summary=<dict from step 5>,
  key_findings=<list of top 3-5 most important finding descriptions>,
  merge_recommendation=<from step 5>
)

Complete ALL steps 0 through 9. Do not stop early.
"""

    try:
        agent(prompt)
        log.info("PR analysis completed")
        return {"status": "completed", "jobId": job_id}
    except Exception as exc:
        log.exception("Orchestrator PR analysis failed", error=str(exc))
        raise


def _run_incident(job_input: dict[str, Any], log: Any) -> dict[str, Any]:
    job_id = job_input["jobId"]
    org_id = job_input.get("orgId", "")
    incident_id = job_input.get("incidentId", job_id)
    service = job_input.get("service", "unknown")
    alarm_name = job_input.get("alarmName", "")

    log.info("Orchestrator incident analysis", incident_id=incident_id, service=service)

    agent = build_agent(INCIDENT_SYSTEM_PROMPT)

    incident_ctx = {
        "incidentId": incident_id,
        "service": service,
        "alarmName": alarm_name,
        "startTime": job_input.get("startTime", ""),
        "endTime": job_input.get("endTime", ""),
        "errorMessages": job_input.get("errorMessages", []),
        "recentDeployments": job_input.get("recentDeployments", []),
    }

    prompt = f"""Investigate production incident for service: {service}

Alarm: {alarm_name}
Org ID: {org_id}
Incident ID: {incident_id}

### Step 0 — Retrieve Past Incident Memory
Call get_incident_memory(org_id="{org_id}", service="{service}", limit=3)
Review past incidents for this service to identify known failure patterns.

### Step 1 — Invoke DevOps Incident Agent
Call invoke_devops_agent(incident_context_json='{json.dumps(incident_ctx)}')
This will investigate CloudWatch metrics, logs, X-Ray traces, and CloudTrail for root cause.

### Step 2 — Save Incident Memory
After the DevOps agent returns its RCA, call save_incident_memory(
  org_id="{org_id}",
  incident_id="{incident_id}",
  service="{service}",
  root_cause=<rootCause from DevOps agent response>,
  resolution=<mitigation from DevOps agent response>,
  affected_services=<affectedServices from response>,
  prevention=<prevention from response>,
  duration_minutes=0
)

### Step 3 — Send Slack Notification
Call send_incident_update(
  incident_id="{incident_id}",
  org_id="{org_id}",
  title="Incident: {alarm_name}",
  status="INVESTIGATING",
  severity="HIGH",
  update_message=<brief summary of rootCause and mitigation steps>,
  affected_services=<affectedServices from DevOps agent>
)

Complete ALL 3 steps.
"""

    try:
        agent(prompt)
        log.info("Incident analysis completed", incident_id=incident_id)
        return {"status": "completed", "jobId": job_id, "incidentId": incident_id}
    except Exception as exc:
        log.exception("Incident analysis failed", error=str(exc))
        raise
