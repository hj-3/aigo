from __future__ import annotations

from functools import lru_cache

from pydantic import Field

from common import BaseAgentConfig, require_env


class AgentConfig(BaseAgentConfig, frozen=True):
    s3_agent_outputs_bucket: str = Field(default_factory=lambda: require_env("S3_AGENT_OUTPUTS_BUCKET"))
    s3_reports_bucket: str = Field(default_factory=lambda: require_env("S3_REPORTS_BUCKET"))
    s3_diffs_bucket: str = Field(default_factory=lambda: require_env("S3_DIFFS_BUCKET"))
    sqs_notification_queue_url: str = Field(default_factory=lambda: require_env("SQS_NOTIFICATION_QUEUE_URL"))
    code_reviewer_agent_id: str = Field(default_factory=lambda: require_env("CODE_REVIEWER_AGENT_ID"))
    code_reviewer_alias_id: str = Field(default_factory=lambda: require_env("CODE_REVIEWER_ALIAS_ID"))
    infra_reviewer_agent_id: str = Field(default_factory=lambda: require_env("INFRA_REVIEWER_AGENT_ID"))
    infra_reviewer_alias_id: str = Field(default_factory=lambda: require_env("INFRA_REVIEWER_ALIAS_ID"))
    risk_reviewer_agent_id: str = Field(default_factory=lambda: require_env("RISK_REVIEWER_AGENT_ID"))
    risk_reviewer_alias_id: str = Field(default_factory=lambda: require_env("RISK_REVIEWER_ALIAS_ID"))
    security_agent_id: str = Field(default_factory=lambda: require_env("SECURITY_AGENT_ID"))
    security_alias_id: str = Field(default_factory=lambda: require_env("SECURITY_ALIAS_ID"))


@lru_cache(maxsize=1)
def get_config() -> AgentConfig:
    return AgentConfig()
