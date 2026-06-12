"""
Orchestrator Agent — coordinates all sub-agent personas for PR analysis.

Flow:
  1. Receive job_input with diffContent (pre-fetched by lambda_handler)
  2. Call invoke_code_reviewer, invoke_infra_reviewer, invoke_risk_reviewer, invoke_security_agent
     — each sub-agent receives diff content directly in their prompt (no action groups needed)
  3. Parse findings from each sub-agent response
  4. Save all findings via save_findings
  5. Compute risk level, generate PR comment, save report
  6. Notify Slack, post GitHub PR comment
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

ORCHESTRATOR_SYSTEM_PROMPT = """You are the AIGO Orchestrator Agent — the master coordinator for automated PR analysis.

## Your Responsibilities
1. Coordinate 4 specialized review agents sequentially
2. Parse and consolidate all their findings
3. Determine overall risk level and merge recommendation
4. Persist results, notify stakeholders

## Sub-Agent Tools
- invoke_code_reviewer(job_input_json, diff_content) → JSON with "findings" array
- invoke_infra_reviewer(job_input_json, diff_content) → JSON with "findings" array
- invoke_risk_reviewer(job_input_json, diff_content) → JSON with "findings" array
- invoke_security_agent(job_input_json, diff_content) → JSON with "findings" array

## Persistence Tools
- save_findings(job_id, agent_name, findings) → confirmation
- save_report(job_id, org_id, repo_id, risk_level, merge_recommendation, summary, findings_by_severity) → report_id
- update_job_status(job_id, status, error_message) → confirmation

## Notification Tools
- notify_analysis_complete(job_id, org_id, repo_id, risk_level, merge_recommendation, summary, findings_count) → confirmation
- post_pr_comment(repo_full_name, pr_number, installation_id, risk_level, merge_recommendation, findings, summary) → confirmation

## Risk Level Rules
- CRITICAL: any CRITICAL severity finding → BLOCK merge
- HIGH: any HIGH severity finding → REQUEST_CHANGES
- MEDIUM: medium findings only → REQUEST_CHANGES
- LOW / INFO: no significant issues → APPROVE

## Required Execution Order
Step 1: Call all 4 sub-agent tools (pass job_input_json and the full diff_content)
Step 2: Parse each JSON response, extract "findings" array
Step 3: Call save_findings 4 times (once per agent)
Step 4: Compute risk_level and merge_recommendation based on findings
Step 5: Call save_report
Step 6: Call notify_analysis_complete
Step 7: Call post_pr_comment

Never skip steps. If a sub-agent returns invalid JSON, treat it as empty findings and continue.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import ddb_tools, github_tools, slack_tools, subagent_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
        tools=[
            subagent_tools.invoke_code_reviewer,
            subagent_tools.invoke_infra_reviewer,
            subagent_tools.invoke_risk_reviewer,
            subagent_tools.invoke_security_agent,
            ddb_tools.save_report,
            ddb_tools.save_findings,
            ddb_tools.update_job_status,
            slack_tools.notify_analysis_complete,
            github_tools.post_pr_comment,
        ],
    )


def run_analysis(job_input: dict[str, Any]) -> dict[str, Any]:
    """Entry point called by lambda_handler.handler."""
    job_id = job_input["jobId"]
    org_id = job_input.get("orgId", "")
    repo_id = job_input.get("repoId", "")
    log = logger.bind(job_id=job_id, org_id=org_id, repo_id=repo_id)

    # Extract diff content — keep it out of job_input_json to avoid duplication in sub-agent prompts
    diff_content = job_input.pop("diffContent", "")
    job_input_json = json.dumps(job_input)

    pr_ctx = job_input.get("prContext", {})
    diff_meta = job_input.get("diffMetadata", {})

    log.info(
        "Orchestrator starting",
        pr_number=pr_ctx.get("prNumber"),
        changed_files=len(diff_meta.get("changedFiles", [])),
        diff_chars=len(diff_content),
    )

    agent = build_agent()

    prompt = f"""Analyze Pull Request #{pr_ctx.get("prNumber")} — {pr_ctx.get("prTitle", "")}.
Repository: {repo_id} | Author: {pr_ctx.get("authorLogin", "")}
Files changed: {len(diff_meta.get("changedFiles", []))} (+{diff_meta.get("additions", 0)} / -{diff_meta.get("deletions", 0)})

## Job Context JSON
{job_input_json}

## PR Diff
```diff
{diff_content}
```

Execute the full analysis pipeline:

1. Call invoke_code_reviewer with:
   - job_input_json = (the Job Context JSON above)
   - diff_content = (the full PR diff above)

2. Call invoke_infra_reviewer with:
   - job_input_json = (the Job Context JSON above)
   - diff_content = (the full PR diff above)

3. Call invoke_risk_reviewer with:
   - job_input_json = (the Job Context JSON above)
   - diff_content = (the full PR diff above)

4. Call invoke_security_agent with:
   - job_input_json = (the Job Context JSON above)
   - diff_content = (the full PR diff above)

5. Parse each sub-agent response as JSON and extract "findings". If parsing fails use [].

6. Save findings:
   - save_findings(job_id="{job_id}", agent_name="code-reviewer", findings=[...from step 1])
   - save_findings(job_id="{job_id}", agent_name="infra-reviewer", findings=[...from step 2])
   - save_findings(job_id="{job_id}", agent_name="risk-reviewer", findings=[...from step 3])
   - save_findings(job_id="{job_id}", agent_name="security-agent", findings=[...from step 4])

7. Determine overall risk_level (CRITICAL/HIGH/MEDIUM/LOW) and merge_recommendation (BLOCK/REQUEST_CHANGES/APPROVE).

8. Call save_report(
     job_id="{job_id}",
     org_id="{org_id}",
     repo_id="{repo_id}",
     risk_level=<determined>,
     merge_recommendation=<determined>,
     summary=<brief 2-3 sentence summary>,
     findings_by_severity={{"CRITICAL": N, "HIGH": N, "MEDIUM": N, "LOW": N, "INFO": N}}
   )

9. Call notify_analysis_complete(
     job_id="{job_id}",
     repo_name="{pr_ctx.get("repoFullName", repo_id)}",
     pr_number={pr_ctx.get("prNumber", 0)},
     pr_url="{pr_ctx.get("prUrl", "")}",
     risk_level=<from step 7>,
     merge_recommendation=<from step 7>,
     findings_summary=<findings_by_severity dict from step 8>,
     report_url="https://app.seolphung.com/reports/<report_id from step 8>"
   )

10. Call post_pr_comment(
      repo_full_name="{pr_ctx.get("repoFullName", "")}",
      pr_number={pr_ctx.get("prNumber", 0)},
      risk_level=<from step 7>,
      merge_recommendation=<from step 7>,
      summary=<summary from step 8>,
      findings_by_severity=<findings_by_severity dict from step 8>,
      report_id=<report_id from step 8>
    )

Complete all 10 steps. Do not stop early.
"""

    try:
        result = agent(prompt)
        log.info("Orchestrator completed successfully")
        return {"status": "completed", "jobId": job_id}
    except Exception as exc:
        log.exception("Orchestrator agent failed", error=str(exc))
        raise
