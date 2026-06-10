"""Unit tests for tools/ddb_tools.py — mock DynamoDB resource."""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
from ddb_tools import _prefix, _table, save_findings, update_job_status  # type: ignore[import]


# ── Table name helpers ────────────────────────────────────────────────────────


def test_prefix_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DYNAMODB_TABLE_PREFIX", "myproject")
    assert _prefix() == "myproject"


def test_prefix_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DYNAMODB_TABLE_PREFIX", raising=False)
    assert _prefix() == "aigo"


@patch("ddb_tools._ddb")
def test_table_constructs_full_name(mock_ddb: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DYNAMODB_TABLE_PREFIX", "prod")
    _table("Findings")
    mock_ddb.return_value.Table.assert_called_once_with("prod-Findings")


# ── save_findings ─────────────────────────────────────────────────────────────


def _mock_table() -> MagicMock:
    tbl = MagicMock()
    tbl.put_item.return_value = {}
    return tbl


@patch("ddb_tools._table")
def test_save_findings_returns_confirmation(mock_table_fn: MagicMock) -> None:
    mock_table_fn.return_value = _mock_table()

    findings = [
        {
            "severity": "HIGH",
            "category": "security",
            "title": "SQL Injection",
            "description": "Unsanitised input passed to query.",
            "evidence": "query = f'SELECT * FROM users WHERE id={id}'",
            "fixable": True,
        }
    ]
    result = save_findings("JOB-001", "code-reviewer", findings)
    assert "1" in result
    assert mock_table_fn.return_value.put_item.call_count == 1


@patch("ddb_tools._table")
def test_save_findings_uses_correct_pk(mock_table_fn: MagicMock) -> None:
    mock_table_fn.return_value = _mock_table()

    save_findings("JOB-XYZ", "security-agent", [
        {
            "severity": "CRITICAL",
            "category": "security",
            "title": "Hardcoded credential",
            "description": "AWS key in source.",
            "evidence": "aws_key = 'AKIA...'",
            "fixable": False,
        }
    ])

    put_call = mock_table_fn.return_value.put_item.call_args
    item = put_call[1]["Item"] if put_call[1] else put_call[0][0]["Item"]
    assert item["PK"].startswith("FINDING#JOB-XYZ")
    assert item["jobId"] == "JOB-XYZ"
    assert item["agentName"] == "security-agent"


@patch("ddb_tools._table")
def test_save_findings_empty_list(mock_table_fn: MagicMock) -> None:
    mock_table_fn.return_value = _mock_table()
    result = save_findings("JOB-001", "code-reviewer", [])
    assert "0" in result
    mock_table_fn.return_value.put_item.assert_not_called()


# ── update_job_status ─────────────────────────────────────────────────────────


@patch("ddb_tools._table")
def test_update_job_status_writes_correct_keys(mock_table_fn: MagicMock) -> None:
    tbl = MagicMock()
    tbl.update_item.return_value = {}
    mock_table_fn.return_value = tbl

    update_job_status("JOB-001", "RUNNING")

    update_call = tbl.update_item.call_args
    key = update_call[1]["Key"] if update_call[1] else update_call[0][0]["Key"]
    assert key == {"PK": "JOB#JOB-001", "SK": "METADATA"}
