"""Shared pytest fixtures — fake AWS credentials, common env vars."""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-2")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-2")
    monkeypatch.setenv("DYNAMODB_TABLE_PREFIX", "aigo-test")
    monkeypatch.setenv("BEDROCK_KB_ID", "test-kb-id-0001")
    monkeypatch.setenv("GITHUB_SECRET_ARN", "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:test")
    monkeypatch.setenv("SLACK_SECRET_ARN", "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:slack-test")
