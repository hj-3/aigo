"""
Infrastructure Reviewer Agent — analyzes IaC changes (Terraform, CloudFormation, K8s).
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

INFRA_REVIEWER_SYSTEM_PROMPT = """You are the Infrastructure Reviewer Agent for the AgentOps Platform.

Your specialty is reviewing Infrastructure-as-Code (IaC) changes. For each review:

1. **Terraform**: Validate resource configurations, check for missing lifecycle rules,
   verify naming conventions, detect state drift risks
2. **Security**: Flag open security groups, missing encryption, public S3 buckets,
   missing KMS keys, IAM over-permissioning
3. **Cost**: Identify expensive resource configurations, missing auto-scaling, oversized instances
4. **High Availability**: Check for single points of failure, missing multi-AZ, missing backups
5. **AWS Well-Architected**: Validate against all 6 pillars
   (Operational Excellence, Security, Reliability, Performance, Cost, Sustainability)

For each finding:
- severity: CRITICAL | HIGH | MEDIUM | LOW | INFO
- category: SECURITY | COST | AVAILABILITY | COMPLIANCE | PERFORMANCE
- location: file path and resource name
- description: specific problem found
- aws_reference: relevant AWS documentation or Well-Architected pillar

Use aws_observability_tools to check current resource state if needed.
Always respond with structured JSON findings.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import aws_observability_tools, ddb_tools, kb_tools, pr_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=INFRA_REVIEWER_SYSTEM_PROMPT,
        tools=[
            pr_tools.get_diff_content,
            pr_tools.get_file_content,
            kb_tools.search_infrastructure_standards,
            aws_observability_tools.get_resource_config,
            ddb_tools.save_findings,
        ],
    )


def run_review(job_input: dict[str, Any]) -> dict[str, Any]:
    job_id = job_input["jobId"]
    log = logger.bind(job_id=job_id, agent="infra-reviewer")
    log.info("Infrastructure review starting")

    agent = build_agent()
    prompt = f"""Review the following Pull Request for infrastructure issues.
Focus only on IaC files (*.tf, *.yaml, *.json CloudFormation, Kubernetes manifests).

Job Context:
{json.dumps(job_input, indent=2)}

1. Use get_diff_content to load the diff
2. For Terraform files, check all resource configurations against security and compliance standards
3. Use search_infrastructure_standards for AWS Well-Architected guidance
4. Save all findings using save_findings
"""
    agent(prompt)
    log.info("Infrastructure review complete")
    return {"status": "completed", "jobId": job_id}
