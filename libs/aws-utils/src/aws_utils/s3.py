from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

_client: Any = None


def _get_client() -> Any:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    return _client


class S3Helper:
    def __init__(self, bucket: str) -> None:
        self.bucket = bucket

    def get_text(self, key: str) -> str:
        resp = _get_client().get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read().decode("utf-8")

    def get_json(self, key: str) -> Any:
        return json.loads(self.get_text(key))

    def put_text(
        self,
        key: str,
        body: str,
        content_type: str = "text/plain; charset=utf-8",
    ) -> None:
        _get_client().put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body.encode("utf-8"),
            ContentType=content_type,
            ServerSideEncryption="aws:kms",
        )

    def put_json(self, key: str, data: Any) -> None:
        self.put_text(key, json.dumps(data, ensure_ascii=False), "application/json")

    def exists(self, key: str) -> bool:
        try:
            _get_client().head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        return _get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )
