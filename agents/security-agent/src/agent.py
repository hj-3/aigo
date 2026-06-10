"""
Security Agent — identifies security vulnerabilities in PR changes.
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from strands import Agent
from strands.models import BedrockModel

from .config import get_config

logger = structlog.get_logger(__name__)

SECURITY_AGENT_SYSTEM_PROMPT = """You are the Security Agent for the AgentOps Platform.

Your specialty is identifying security vulnerabilities in Pull Request code changes.
Apply OWASP Top 10, CWE, and AWS security best practices.

Key areas to check:

1. **Injection Flaws**: SQL injection, Command injection, LDAP injection, NoSQL injection
2. **Authentication & Authorization**: Hardcoded credentials, weak auth, missing authorization checks, JWT issues
3. **Sensitive Data Exposure**: Secrets in code, PII in logs, unencrypted storage, weak encryption
4. **Security Misconfiguration**: CORS issues, debug endpoints, insecure defaults, missing security headers
5. **Vulnerable Dependencies**: Known CVEs in added/updated packages (check against known vulnerability patterns)
6. **Insecure Deserialization**: Unsafe pickle, YAML, or XML parsing
7. **Insufficient Logging**: Missing audit logs for security events, sensitive data in logs
8. **SSRF**: Unvalidated URLs, internal endpoint exposure
9. **XSS**: Unsanitized output, missing CSP, innerHTML usage
10. **Cryptography**: Weak algorithms (MD5, SHA1), hardcoded keys, ECB mode usage

Severity mapping:
- CRITICAL: Remote code execution, auth bypass, SQL injection
- HIGH: XSS, CSRF, sensitive data exposure, SSRF
- MEDIUM: Security misconfiguration, weak cryptography
- LOW: Missing security headers, verbose error messages
- INFO: Best practice suggestions

All CRITICAL and HIGH findings block the merge automatically.
"""


def build_agent() -> Agent:
    config = get_config()

    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
        max_tokens=8192,
        temperature=0.0,
    )

    from tools import pr_tools, ddb_tools, kb_tools  # noqa: PLC0415

    return Agent(
        model=model,
        system_prompt=SECURITY_AGENT_SYSTEM_PROMPT,
        tools=[
            pr_tools.get_diff_content,
            pr_tools.get_file_content,
            kb_tools.search_security_standards,
            ddb_tools.save_findings,
        ],
    )


def run_review(job_input: dict[str, Any]) -> dict[str, Any]:
    job_id = job_input["jobId"]
    log = logger.bind(job_id=job_id, agent="security-agent")
    log.info("Security review starting")

    agent = build_agent()
    prompt = f"""Perform a comprehensive security review of the following Pull Request.

Job Context:
{json.dumps(job_input, indent=2)}

1. Use get_diff_content to analyze all code changes
2. Check each change against OWASP Top 10 and CWE patterns
3. Look for hardcoded secrets, credentials, API keys
4. Check dependency changes for known vulnerabilities
5. Save all security findings using save_findings — be thorough, don't miss anything
"""
    result = agent(prompt)
    log.info("Security review complete")
    return {"status": "completed", "jobId": job_id}
