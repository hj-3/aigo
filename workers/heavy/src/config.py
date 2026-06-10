import os
from functools import lru_cache
from pydantic import BaseModel, Field


class WorkerConfig(BaseModel, frozen=True):
    aws_region: str = Field(default_factory=lambda: os.environ.get("AWS_REGION", "ap-northeast-2"))
    github_secret_arn: str = Field(default_factory=lambda: _require("GITHUB_SECRET_ARN"))
    dynamodb_table_prefix: str = Field(default_factory=lambda: os.environ.get("DYNAMODB_TABLE_PREFIX", "aigo"))
    s3_patches_bucket: str = Field(default_factory=lambda: _require("S3_PATCHES_BUCKET"))
    s3_diffs_bucket: str = Field(default_factory=lambda: _require("S3_DIFFS_BUCKET"))
    s3_agent_outputs_bucket: str = Field(default_factory=lambda: _require("S3_AGENT_OUTPUTS_BUCKET"))
    sqs_fix_queue_url: str = Field(default_factory=lambda: _require("SQS_FIX_QUEUE_URL"))
    sqs_notification_queue_url: str = Field(default_factory=lambda: _require("SQS_NOTIFICATION_QUEUE_URL"))
    clone_workspace: str = Field(default_factory=lambda: os.environ.get("CLONE_WORKSPACE", "/tmp/repos"))
    max_patch_size_bytes: int = 5 * 1024 * 1024  # 5MB

    def table(self, name: str) -> str:
        return f"{self.dynamodb_table_prefix}-{name}"


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


@lru_cache(maxsize=1)
def get_config() -> WorkerConfig:
    return WorkerConfig()
