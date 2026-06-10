"""
Risk Reviewer Agent — assesses business risk of PR changes.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

RISK_REVIEWER_SYSTEM_PROMPT = """You are the Risk Reviewer Agent for the AgentOps Platform.

Your specialty is assessing the business and technical risk of Pull Request changes. For each review:

1. **Breaking Changes**: API contract changes, removed endpoints, changed response schemas, database schema changes
2. **Data Migration Risk**: Schema migrations, data transformation logic, rollback complexity
3. **Backward Compatibility**: Client compatibility, version bumps needed, deprecation warnings
4. **Dependency Risk**: New dependencies, version updates (especially major), transitive dependency conflicts
5. **Deployment Risk**: Zero-downtime deployment feasibility, required config changes, infra coordination needed
6. **Blast Radius**: How many systems/users are affected if this change fails

Risk Scoring:
- CRITICAL: Could cause data loss, full outage, or security breach
- HIGH: Could cause partial outage or significant user impact
- MEDIUM: Degraded experience for some users
- LOW: Minimal impact, easy rollback
- INFO: Informational only

Always provide a merge_recommendation: APPROVE | REQUEST_CHANGES | BLOCK
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import pr_tools, ddb_tools, kb_tools, repo_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=RISK_REVIEWER_SYSTEM_PROMPT,
        tools=[
            pr_tools.get_diff_content,
            pr_tools.get_file_content,
            repo_tools.get_dependency_graph,
            repo_tools.get_api_schema,
            kb_tools.search_risk_policies,
            ddb_tools.save_findings,
        ],
    )


def run_review(job_input: dict[str, Any]) -> dict[str, Any]:
    job_id = job_input["jobId"]
    log = logger.bind(job_id=job_id, agent="risk-reviewer")
    log.info("Risk review starting")

    agent = build_agent()
    prompt = f"""Assess the business and technical risk of the following Pull Request.

Job Context:
{json.dumps(job_input, indent=2)}

1. Use get_diff_content to analyze the changes
2. Check for breaking changes in APIs, schemas, and interfaces
3. Use get_dependency_graph to understand impact on dependent services
4. Provide a merge recommendation with detailed risk assessment
5. Save findings using save_findings
"""
    result = agent(prompt)
    log.info("Risk review complete")
    return {"status": "completed", "jobId": job_id}
