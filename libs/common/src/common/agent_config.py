"""Base configuration class for AgentOps agents — imported by all 7 agents."""
from __future__ import annotations

import os

from pydantic import BaseModel, Field


def require_env(key: str) -> str:
    """Returns env var value, raises RuntimeError if not set."""
    v = os.environ.get(key)
    if not v:
        raise RuntimeError(f"Missing required env var: {key}")
    return v


class BaseAgentConfig(BaseModel, frozen=True):
    """Common fields shared by every AgentOps agent."""

    aws_region: str = Field(
        default_factory=lambda: os.environ.get("AWS_REGION", "ap-northeast-2")
    )
    model_id: str = Field(
        default_factory=lambda: os.environ.get(
            "MODEL_ID", "us.anthropic.claude-sonnet-4-6-20250514-v1:0"
        )
    )
    dynamodb_table_prefix: str = Field(
        default_factory=lambda: os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo")
    )

    def table(self, name: str) -> str:
        """Returns the full DynamoDB table name for the given logical table name."""
        return f"{self.dynamodb_table_prefix}-{name}"
