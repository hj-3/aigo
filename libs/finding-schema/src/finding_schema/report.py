from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field

from .finding import AgentFinding


class RiskLevel(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class MergeRecommendation(StrEnum):
    APPROVE = "APPROVE"
    APPROVE_WITH_FIXES = "APPROVE_WITH_FIXES"
    REQUEST_CHANGES = "REQUEST_CHANGES"
    BLOCK = "BLOCK"


class FindingCounts(BaseModel):
    model_config = {"frozen": True}

    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0

    @property
    def total(self) -> int:
        return self.critical + self.high + self.medium + self.low + self.info


class AgentSummaries(BaseModel):
    model_config = {"frozen": True}

    code_review: str | None = None
    infra_review: str | None = None
    security_review: str | None = None
    risk_assessment: str


class AgentReport(BaseModel):
    """Aggregated output from all agents for a single analysis job."""

    model_config = {"frozen": True}

    job_id: str
    org_id: str
    repo_id: str
    risk_score: Annotated[int, Field(ge=0, le=100)]
    risk_level: RiskLevel
    merge_recommendation: MergeRecommendation
    findings: list[AgentFinding] = Field(default_factory=list)
    finding_counts: FindingCounts
    agent_summaries: AgentSummaries

    @classmethod
    def compute_risk_level(cls, score: int) -> RiskLevel:
        if score >= 80:
            return RiskLevel.CRITICAL
        if score >= 60:
            return RiskLevel.HIGH
        if score >= 40:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW

    @classmethod
    def compute_merge_recommendation(
        cls, risk_level: RiskLevel, has_critical: bool, has_high: bool
    ) -> MergeRecommendation:
        if risk_level == RiskLevel.CRITICAL or has_critical:
            return MergeRecommendation.BLOCK
        if risk_level == RiskLevel.HIGH or has_high:
            return MergeRecommendation.REQUEST_CHANGES
        if risk_level == RiskLevel.MEDIUM:
            return MergeRecommendation.APPROVE_WITH_FIXES
        return MergeRecommendation.APPROVE
