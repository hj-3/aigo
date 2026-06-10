"""Unit tests for finding-schema Pydantic models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from finding_schema import (
    AgentFinding,
    AgentReport,
    AgentSummaries,
    FindingCategory,
    FindingLocation,
    MergeRecommendation,
    RiskLevel,
    Severity,
)
from finding_schema.report import FindingCounts


# ── AgentFinding ──────────────────────────────────────────────────────────────


def _make_finding(**overrides: object) -> AgentFinding:
    defaults: dict[str, object] = {
        "agent": "code-reviewer",
        "severity": Severity.HIGH,
        "category": FindingCategory.SECURITY,
        "title": "SQL Injection",
        "description": "User input passed directly to query.",
        "evidence": "query = f'SELECT * FROM users WHERE id={user_id}'",
        "confidence": 0.95,
    }
    return AgentFinding(**(defaults | overrides))


def test_finding_valid() -> None:
    f = _make_finding()
    assert f.severity == Severity.HIGH
    assert f.category == FindingCategory.SECURITY
    assert f.confidence == 0.95


def test_finding_empty_title_raises() -> None:
    with pytest.raises(ValidationError, match="title must not be empty"):
        _make_finding(title="   ")


def test_finding_confidence_out_of_range_raises() -> None:
    with pytest.raises(ValidationError):
        _make_finding(confidence=1.5)

    with pytest.raises(ValidationError):
        _make_finding(confidence=-0.1)


def test_finding_with_location() -> None:
    loc = FindingLocation(file="src/db.py", start_line=42, end_line=44)
    f = _make_finding(location=loc)
    assert f.location is not None
    assert f.location.file == "src/db.py"
    assert f.location.start_line == 42


@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        (Severity.CRITICAL, Severity.CRITICAL),
        (Severity.INFO, Severity.INFO),
    ],
)
def test_finding_severity_values(severity: Severity, expected: Severity) -> None:
    f = _make_finding(severity=severity)
    assert f.severity == expected


# ── AgentReport helpers ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0, RiskLevel.LOW),
        (39, RiskLevel.LOW),
        (40, RiskLevel.MEDIUM),
        (59, RiskLevel.MEDIUM),
        (60, RiskLevel.HIGH),
        (79, RiskLevel.HIGH),
        (80, RiskLevel.CRITICAL),
        (100, RiskLevel.CRITICAL),
    ],
)
def test_compute_risk_level(score: int, expected: RiskLevel) -> None:
    assert AgentReport.compute_risk_level(score) == expected


@pytest.mark.parametrize(
    ("risk_level", "has_critical", "has_high", "expected"),
    [
        (RiskLevel.CRITICAL, False, False, MergeRecommendation.BLOCK),
        (RiskLevel.LOW, True, False, MergeRecommendation.BLOCK),
        (RiskLevel.HIGH, False, False, MergeRecommendation.REQUEST_CHANGES),
        (RiskLevel.LOW, False, True, MergeRecommendation.REQUEST_CHANGES),
        (RiskLevel.MEDIUM, False, False, MergeRecommendation.APPROVE_WITH_FIXES),
        (RiskLevel.LOW, False, False, MergeRecommendation.APPROVE),
    ],
)
def test_compute_merge_recommendation(
    risk_level: RiskLevel,
    has_critical: bool,
    has_high: bool,
    expected: MergeRecommendation,
) -> None:
    result = AgentReport.compute_merge_recommendation(risk_level, has_critical, has_high)
    assert result == expected


def test_finding_counts_total() -> None:
    counts = FindingCounts(critical=2, high=3, medium=5, low=1, info=0)
    assert counts.total == 11


def test_agent_report_round_trip() -> None:
    finding = _make_finding()
    counts = FindingCounts(high=1)
    summaries = AgentSummaries(risk_assessment="Medium risk — one SQL injection in non-critical path.")
    report = AgentReport(
        job_id="JOB-001",
        org_id="ORG-001",
        repo_id="REPO-001",
        risk_score=65,
        risk_level=RiskLevel.HIGH,
        merge_recommendation=MergeRecommendation.REQUEST_CHANGES,
        findings=[finding],
        finding_counts=counts,
        agent_summaries=summaries,
    )
    assert report.risk_score == 65
    assert len(report.findings) == 1
    assert report.finding_counts.total == 1
