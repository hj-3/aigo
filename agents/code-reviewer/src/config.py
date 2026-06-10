from __future__ import annotations

from functools import lru_cache

from pydantic import Field

from common import BaseAgentConfig, require_env


class AgentConfig(BaseAgentConfig):
    s3_diffs_bucket: str = Field(default_factory=lambda: require_env("S3_DIFFS_BUCKET"))
    s3_agent_outputs_bucket: str = Field(default_factory=lambda: require_env("S3_AGENT_OUTPUTS_BUCKET"))


@lru_cache(maxsize=1)
def get_config() -> AgentConfig:
    return AgentConfig()
