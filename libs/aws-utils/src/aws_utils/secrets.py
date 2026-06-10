from __future__ import annotations

import json
import os
import time
from typing import Any

import boto3

_client: Any = None
_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 300  # 5 minutes


def _get_client() -> Any:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = boto3.client(
            "secretsmanager",
            region_name=os.environ.get("AWS_REGION", "ap-northeast-2"),
        )
    return _client


class SecretsHelper:
    @staticmethod
    def get_string(secret_arn: str) -> str:
        cached = _cache.get(secret_arn)
        if cached and cached[1] > time.time():
            return cached[0]

        resp = _get_client().get_secret_value(SecretId=secret_arn)
        value: str = resp.get("SecretString", "")
        if not value:
            raise ValueError(f"Secret has no string value: {secret_arn}")

        _cache[secret_arn] = (value, time.time() + _CACHE_TTL)
        return value

    @staticmethod
    def get_json(secret_arn: str) -> dict[str, Any]:
        return json.loads(SecretsHelper.get_string(secret_arn))
