from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, field_validator


class Severity(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class FindingCategory(StrEnum):
    SECURITY = "security"
    QUALITY = "quality"
    PERFORMANCE = "performance"
    COST = "cost"
    COMPLIANCE = "compliance"
    STYLE = "style"
    INFRASTRUCTURE = "infrastructure"
    DEPENDENCY = "dependency"


class FindingLocation(BaseModel):
    model_config = {"frozen": True}

    file: str
    start_line: int
    end_line: int | None = None
    column: int | None = None


class AgentFinding(BaseModel):
    """Canonical finding payload emitted by agents. Stored in DynamoDB + S3."""

    model_config = {"frozen": True}

    agent: str  # AgentType literal
    severity: Severity
    category: FindingCategory
    title: str
    description: str
    evidence: str
    location: FindingLocation | None = None
    fixable: bool = False
    confidence: Annotated[float, Field(ge=0.0, le=1.0)] = 0.8
    fix_suggestion: str | None = None
    rule_id: str | None = None
    references: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be empty")
        return v.strip()

    @field_validator("confidence")
    @classmethod
    def confidence_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        return round(v, 4)
