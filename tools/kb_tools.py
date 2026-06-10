"""
Knowledge Base Tools — search Bedrock Knowledge Base for coding standards,
security policies, and infrastructure guidelines.
"""
from __future__ import annotations

import os
import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _kb_client():
    return boto3.client(
        "bedrock-agent-runtime",
        region_name=os.environ.get("AWS_REGION", "ap-northeast-2"),
    )


def _require_kb_id() -> str:
    v = os.environ.get("BEDROCK_KB_ID")
    if not v:
        raise RuntimeError("BEDROCK_KB_ID not set")
    return v


def _search_kb(query: str, filter_tag: str | None = None) -> str:
    kb_id = _require_kb_id()
    params = {
        "knowledgeBaseId": kb_id,
        "retrievalQuery": {"text": query},
        "retrievalConfiguration": {
            "vectorSearchConfiguration": {
                "numberOfResults": 5,
                **({"filter": {"equals": {"key": "category", "value": filter_tag}}} if filter_tag else {}),
            }
        },
    }
    response = _kb_client().retrieve(**params)
    results = response.get("retrievalResults", [])
    if not results:
        return "No relevant guidelines found."

    chunks = []
    for r in results:
        content = r.get("content", {}).get("text", "")
        location = r.get("location", {}).get("s3Location", {}).get("uri", "")
        score = r.get("score", 0)
        chunks.append(f"[Source: {location}, Relevance: {score:.2f}]\n{content}")

    return "\n\n---\n\n".join(chunks)


@tool
def search_coding_standards(query: str) -> str:
    """
    Searches the organization's coding standards knowledge base.

    Args:
        query: Natural language query about coding standards or best practices

    Returns:
        Relevant coding standards and guidelines
    """
    logger.info("Searching coding standards KB", query=query)
    return _search_kb(query, filter_tag="coding_standards")


@tool
def search_infrastructure_standards(query: str) -> str:
    """
    Searches AWS infrastructure and Well-Architected guidelines.

    Args:
        query: Natural language query about infrastructure best practices

    Returns:
        Relevant infrastructure standards and AWS guidance
    """
    logger.info("Searching infrastructure standards KB", query=query)
    return _search_kb(query, filter_tag="infrastructure")


@tool
def search_security_standards(query: str) -> str:
    """
    Searches security policies, OWASP guidelines, and compliance requirements.

    Args:
        query: Natural language query about security requirements

    Returns:
        Relevant security standards and compliance guidelines
    """
    logger.info("Searching security standards KB", query=query)
    return _search_kb(query, filter_tag="security")


@tool
def search_risk_policies(query: str) -> str:
    """
    Searches risk management policies and change management guidelines.

    Args:
        query: Natural language query about risk and change management

    Returns:
        Relevant risk policies and deployment guidelines
    """
    logger.info("Searching risk policies KB", query=query)
    return _search_kb(query, filter_tag="risk")
