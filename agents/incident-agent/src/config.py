from __future__ import annotations

from functools import lru_cache

from pydantic import Field

from common import BaseAgentConfig, require_env


class AgentConfig(BaseAgentConfig, frozen=True):
    s3_incidents_bucket: str = Field(default_factory=lambda: require_env("S3_INCIDENTS_BUCKET"))
    sqs_notification_queue_url: str = Field(default_factory=lambda: require_env("SQS_NOTIFICATION_QUEUE_URL"))


@lru_cache(maxsize=1)
def get_config() -> AgentConfig:
    return AgentConfig()
