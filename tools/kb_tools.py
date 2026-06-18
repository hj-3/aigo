"""
Knowledge Base Tools — S3 Vector Search (Titan Embeddings v2 + cosine similarity).

Architecture:
  - KB documents embedded offline (scripts/build-kb-index.py)
  - Index stored as JSON at S3: KB_BUCKET/vector-index/index.json
  - Lambda cold start: download index → cache in /tmp
  - Query time: embed query via Titan → cosine similarity → top-5 chunks

Cost: ~$0.00002/1K tokens (Titan Embeddings) — effectively $0-3/month vs $700/month for AOSS.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import time
from typing import Any

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)

_INDEX_CACHE: list[dict] | None = None
_INDEX_CACHE_TS: float = 0
_INDEX_CACHE_TTL = 3600  # re-download once per Lambda container lifetime hour


def _bedrock_runtime() -> Any:
    return boto3.client(
        "bedrock-runtime",
        region_name=os.environ.get("AWS_REGION", "ap-northeast-2"),
    )


def _s3_client() -> Any:
    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))


def _load_index() -> list[dict]:
    global _INDEX_CACHE, _INDEX_CACHE_TS
    now = time.monotonic()
    if _INDEX_CACHE is not None and now - _INDEX_CACHE_TS < _INDEX_CACHE_TTL:
        return _INDEX_CACHE

    bucket = os.environ.get("KB_BUCKET", "aigo-kb")
    key = os.environ.get("KB_INDEX_KEY", "vector-index/index.json")

    try:
        resp = _s3_client().get_object(Bucket=bucket, Key=key)
        data = json.loads(resp["Body"].read())
        _INDEX_CACHE = data
        _INDEX_CACHE_TS = now
        logger.info("KB index loaded", chunks=len(data), bucket=bucket, key=key)
        return data
    except Exception as exc:
        logger.warning("Failed to load KB index from S3", error=str(exc), bucket=bucket, key=key)
        return []


def _embed(text: str) -> list[float] | None:
    try:
        resp = _bedrock_runtime().invoke_model(
            modelId="amazon.titan-embed-text-v2:0",
            body=json.dumps({"inputText": text[:8000], "dimensions": 1024, "normalize": True}),
            contentType="application/json",
            accept="application/json",
        )
        body = json.loads(resp["body"].read())
        return body.get("embedding")
    except Exception as exc:
        logger.warning("Titan embedding failed", error=str(exc))
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _search(query: str, category: str | None = None, top_k: int = 5) -> str:
    index = _load_index()
    if not index:
        logger.warning("KB index empty or unavailable — skipping KB search")
        return "Knowledge Base not available. Proceeding with built-in knowledge only."

    query_vec = _embed(query)
    if query_vec is None:
        return "Knowledge Base embedding failed. Proceeding with built-in knowledge only."

    # Filter by category if requested
    candidates = [
        c for c in index
        if category is None or c.get("metadata", {}).get("category") == category
    ] if category else index

    if not candidates:
        return f"No KB documents found for category '{category}'."

    # Score all candidates
    scored = sorted(
        [{"chunk": c, "score": _cosine_similarity(query_vec, c["embedding"])} for c in candidates],
        key=lambda x: x["score"],
        reverse=True,
    )[:top_k]

    # Filter out low-relevance results
    relevant = [s for s in scored if s["score"] >= 0.5]
    if not relevant:
        return "No highly relevant guidelines found. Proceeding with built-in knowledge."

    chunks = []
    for s in relevant:
        meta = s["chunk"].get("metadata", {})
        source = meta.get("source", "KB")
        text = s["chunk"].get("text", "")
        chunks.append(f"[Source: {source}, Relevance: {s['score']:.2f}]\n{text}")

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
    return _search(query, category="coding_standards")


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
    return _search(query, category="infrastructure")


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
    return _search(query, category="security")


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
    return _search(query, category="risk")
