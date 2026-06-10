from __future__ import annotations

import json
import os
import uuid
from typing import Any

import boto3

_client: Any = None


def _get_client() -> Any:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = boto3.client("sqs", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    return _client


class SqsHelper:
    def __init__(self, queue_url: str) -> None:
        self.queue_url = queue_url

    def send(
        self,
        payload: dict[str, Any],
        message_group_id: str | None = None,
        deduplication_id: str | None = None,
    ) -> str:
        kwargs: dict[str, Any] = {
            "QueueUrl": self.queue_url,
            "MessageBody": json.dumps(payload, ensure_ascii=False),
        }
        if message_group_id:
            kwargs["MessageGroupId"] = message_group_id
        if deduplication_id or message_group_id:
            kwargs["MessageDeduplicationId"] = deduplication_id or str(uuid.uuid4())

        resp = _get_client().send_message(**kwargs)
        return resp.get("MessageId", "")
