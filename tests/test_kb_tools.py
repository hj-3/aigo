"""Unit tests for tools/kb_tools.py — mock Bedrock KB client."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
from kb_tools import _require_kb_id, _search_kb  # type: ignore[import]


# ── _require_kb_id ────────────────────────────────────────────────────────────


def test_require_kb_id_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BEDROCK_KB_ID", "kb-abc-123")
    assert _require_kb_id() == "kb-abc-123"


def test_require_kb_id_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BEDROCK_KB_ID", raising=False)
    with pytest.raises(RuntimeError, match="BEDROCK_KB_ID not set"):
        _require_kb_id()


# ── _search_kb ────────────────────────────────────────────────────────────────

_RETRIEVAL_RESULT = {
    "content": {"text": "Use parameterised queries to prevent SQL injection."},
    "location": {"s3Location": {"uri": "s3://kb-bucket/security/sql-injection.md"}},
    "score": 0.92,
}


def _mock_client(results: list[dict]) -> MagicMock:
    client = MagicMock()
    client.retrieve.return_value = {"retrievalResults": results}
    return client


@patch("kb_tools._kb_client")
def test_search_kb_returns_formatted_text(mock_factory: MagicMock) -> None:
    mock_factory.return_value = _mock_client([_RETRIEVAL_RESULT])
    result = _search_kb("SQL injection prevention")
    assert "parameterised queries" in result
    assert "0.92" in result


@patch("kb_tools._kb_client")
def test_search_kb_no_results(mock_factory: MagicMock) -> None:
    mock_factory.return_value = _mock_client([])
    result = _search_kb("unknown topic with no hits")
    assert result == "No relevant guidelines found."


@patch("kb_tools._kb_client")
def test_search_kb_passes_filter_tag(mock_factory: MagicMock) -> None:
    mock_client = _mock_client([_RETRIEVAL_RESULT])
    mock_factory.return_value = mock_client

    _search_kb("security policy", filter_tag="security")

    call_kwargs = mock_client.retrieve.call_args[1]
    retrieval_config = call_kwargs.get("retrievalConfiguration", {})
    vec_config = retrieval_config.get("vectorSearchConfiguration", {})
    assert vec_config.get("filter") == {
        "equals": {"key": "category", "value": "security"}
    }


@patch("kb_tools._kb_client")
def test_search_kb_no_filter_when_tag_is_none(mock_factory: MagicMock) -> None:
    mock_client = _mock_client([_RETRIEVAL_RESULT])
    mock_factory.return_value = mock_client

    _search_kb("general query", filter_tag=None)

    call_kwargs = mock_client.retrieve.call_args[1]
    vec_config = call_kwargs["retrievalConfiguration"]["vectorSearchConfiguration"]
    assert "filter" not in vec_config
