"""
Code Reviewer Agent — analyzes code quality, patterns, test coverage, and style.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

CODE_REVIEWER_SYSTEM_PROMPT = """You are the Code Reviewer Agent for the AgentOps Platform.

Your specialty is reviewing code quality in Pull Requests. For each review:

1. **Code Quality**: Identify anti-patterns, dead code, complexity issues, naming problems
2. **Test Coverage**: Check if changed code has adequate test coverage; flag untested code paths
3. **Error Handling**: Verify proper error handling, missing null checks, unhandled exceptions
4. **Performance**: Identify N+1 queries, unnecessary loops, memory leaks, blocking calls
5. **Documentation**: Flag missing or outdated docstrings, complex logic without comments

For each finding, provide:
- severity: CRITICAL | HIGH | MEDIUM | LOW | INFO
- category: CODE_QUALITY | TEST_COVERAGE | ERROR_HANDLING | PERFORMANCE | DOCUMENTATION
- location: file path and line numbers
- description: specific problem found
- fixable: whether the Fix Agent can auto-fix this
- fix_suggestion: concrete code change if fixable

Use the available tools to read the diff and save your findings.
Always respond with structured JSON findings — never freeform text.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import ddb_tools, kb_tools, pr_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=CODE_REVIEWER_SYSTEM_PROMPT,
        tools=[
            pr_tools.get_diff_content,
            pr_tools.get_file_content,
            kb_tools.search_coding_standards,
            ddb_tools.save_findings,
        ],
    )


def run_review(job_input: dict[str, Any]) -> dict[str, Any]:
    job_id = job_input["jobId"]
    log = logger.bind(job_id=job_id, agent="code-reviewer")
    log.info("Code review starting")

    agent = build_agent()
    prompt = f"""Review the following Pull Request for code quality issues.

Job Context:
{json.dumps(job_input, indent=2)}

1. Use get_diff_content to load the full diff
2. For each changed file, use get_file_content if you need more context
3. Search coding standards using search_coding_standards for relevant guidelines
4. Identify all code quality issues and call save_findings with your results
5. Return a summary of findings found
"""
    result = agent(prompt)
    log.info("Code review complete")
    return {"status": "completed", "jobId": job_id, "result": str(result)}
