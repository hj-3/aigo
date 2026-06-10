import os
from functools import lru_cache


class AWSConfig:
    """Runtime configuration sourced exclusively from environment variables."""

    @staticmethod
    def require(key: str) -> str:
        value = os.environ.get(key)
        if not value:
            raise RuntimeError(f"Missing required environment variable: {key}")
        return value

    @staticmethod
    def optional(key: str, default: str = "") -> str:
        return os.environ.get(key, default)

    @property
    def region(self) -> str:
        return self.optional("AWS_REGION", "ap-northeast-2")

    @property
    def stage(self) -> str:
        return self.optional("STAGE", "prod")

    @property
    def table_prefix(self) -> str:
        return self.optional("DYNAMODB_TABLE_PREFIX", "aigo")

    def table_name(self, name: str) -> str:
        return f"{self.table_prefix}-{name}"

    @property
    def s3_diffs_bucket(self) -> str:
        return self.require("S3_DIFFS_BUCKET")

    @property
    def s3_reports_bucket(self) -> str:
        return self.require("S3_REPORTS_BUCKET")

    @property
    def s3_agent_outputs_bucket(self) -> str:
        return self.require("S3_AGENT_OUTPUTS_BUCKET")

    @property
    def s3_patches_bucket(self) -> str:
        return self.require("S3_PATCHES_BUCKET")

    @property
    def s3_incidents_bucket(self) -> str:
        return self.require("S3_INCIDENTS_BUCKET")


@lru_cache(maxsize=1)
def get_config() -> AWSConfig:
    return AWSConfig()
