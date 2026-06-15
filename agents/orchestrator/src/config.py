from __future__ import annotations

import os
from functools import lru_cache

from pydantic import Field

from common import BaseAgentConfig, require_env


class AgentConfig(BaseAgentConfig, frozen=True):
    s3_agent_outputs_bucket: str = Field(default_factory=lambda: require_env("S3_AGENT_OUTPUTS_BUCKET"))
    s3_reports_bucket: str = Field(default_factory=lambda: require_env("S3_REPORTS_BUCKET"))
    s3_diffs_bucket: str = Field(default_factory=lambda: require_env("S3_DIFFS_BUCKET"))
    sqs_notification_queue_url: str = Field(default_factory=lambda: require_env("SQS_NOTIFICATION_QUEUE_URL"))
    incident_agent_id: str = Field(default_factory=lambda: require_env("INCIDENT_AGENT_ID"))
    incident_alias_id: str = Field(default_factory=lambda: os.environ.get("INCIDENT_AGENT_ALIAS_ID", "TSTALIASID"))
    # Bedrock Guardrail — optional; if set, applied to BedrockModel for prompt injection protection
    guardrail_id: str = Field(default_factory=lambda: os.environ.get("BEDROCK_GUARDRAIL_ID", ""))
    guardrail_version: str = Field(default_factory=lambda: os.environ.get("BEDROCK_GUARDRAIL_VERSION", "DRAFT"))


@lru_cache(maxsize=1)
def get_config() -> AgentConfig:
    return AgentConfig()
