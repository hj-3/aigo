"""
Fix Agent — generates code patches for fixable findings.

CRITICAL CONSTRAINT: This agent ONLY creates patches (unified diff files).
It NEVER runs terraform apply, kubectl apply, or any AWS resource modification.
All infrastructure fixes are in patch form for human review via the Fix PR.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

FIX_AGENT_SYSTEM_PROMPT = """You are the Fix Agent for the AgentOps Platform.

Your role is to generate code patches (unified diff format) that fix identified issues.

CRITICAL RULES:
1. You ONLY generate patches — you NEVER execute code, run terraform, kubectl, or any other tool
2. All fixes must be in unified diff format (git diff output format)
3. Never modify files outside the repository (no system files, no AWS Console, no kubectl)
4. Fixes must be minimal — only change what's necessary to fix the specific finding
5. Never introduce new dependencies without approval

Patch Generation Process:
1. Read the original file content using get_file_content
2. Read the diff to understand the current change context
3. Generate a precise unified diff patch that fixes the issue
4. Validate the patch syntax before saving
5. Save the patch using save_patch tool

Patch Format (unified diff):
```
--- a/path/to/file
+++ b/path/to/file
@@ -line,count +line,count @@
 context line
-removed line
+added line
 context line
```

Each finding should have its own focused patch. Do not bundle unrelated fixes.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import ddb_tools, patch_tools, pr_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=FIX_AGENT_SYSTEM_PROMPT,
        tools=[
            pr_tools.get_diff_content,
            pr_tools.get_file_content,
            patch_tools.save_patch,
            patch_tools.validate_patch_syntax,
            ddb_tools.update_fix_request,
            ddb_tools.get_findings_for_report,
        ],
    )


def generate_fixes(fix_input: dict[str, Any]) -> dict[str, Any]:
    """
    Entry point for fix generation.
    fix_input contains: fixId, reportId, jobId, orgId, repoId, targetFindings (optional)
    """
    fix_id = fix_input["fixId"]
    report_id = fix_input["reportId"]
    log = logger.bind(fix_id=fix_id, report_id=report_id, agent="fix-agent")
    log.info("Fix generation starting")

    agent = build_agent()
    target_findings = fix_input.get("targetFindings", [])
    findings_filter = (
        f"Focus on these specific finding IDs: {', '.join(target_findings)}"
        if target_findings
        else "Fix all findings marked as fixable=true"
    )

    prompt = f"""Generate code patches to fix issues identified in report {report_id}.

Fix Request Context:
{json.dumps(fix_input, indent=2)}

Instructions:
1. Use get_findings_for_report to load all findings for this report
2. {findings_filter}
3. For each fixable finding:
   a. Use get_file_content to read the original file
   b. Generate a precise unified diff patch
   c. Use validate_patch_syntax to verify the patch is valid
   d. Use save_patch to store the patch to S3
4. Update the fix request using update_fix_request with the patch S3 key
5. Return a summary of what was fixed

Remember: ONLY generate patches. Never execute code or modify AWS resources directly.
"""
    agent(prompt)
    log.info("Fix generation complete", fix_id=fix_id)
    return {"status": "completed", "fixId": fix_id}
