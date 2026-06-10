from __future__ import annotations

from pydantic import BaseModel


class PrContext(BaseModel):
    model_config = {"frozen": True}

    pr_number: int
    pr_title: str
    pr_url: str
    commit_sha: str
    base_branch: str
    head_branch: str
    author_login: str
    diff_s3_key: str


class AnalysisInput(BaseModel):
    """Passed to agents when starting a PR analysis job."""

    model_config = {"frozen": True}

    job_id: str
    org_id: str
    repo_id: str
    repo_full_name: str
    pr_context: PrContext
    org_settings: dict[str, object]
    memory_session_id: str


class FixInput(BaseModel):
    """Passed to Fix Agent when a fix is requested."""

    model_config = {"frozen": True}

    fix_id: str
    job_id: str
    org_id: str
    repo_id: str
    repo_full_name: str
    pr_context: PrContext
    target_finding_ids: list[str]
    patch_s3_key_prefix: str


class IncidentInput(BaseModel):
    """Passed to Incident Agent when an AWS alarm fires."""

    model_config = {"frozen": True}

    incident_id: str
    org_id: str
    service_id: str
    title: str
    aws_alarm_arn: str | None
    aws_region: str
    affected_resources: list[str]
    lookback_minutes: int = 60
