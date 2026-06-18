#!/usr/bin/env python3
"""
KB Index Builder — embeds all docs/kb/**/*.md with Titan Embeddings v2
and uploads the resulting vector index to S3.

Usage:
  python scripts/build-kb-index.py
  python scripts/build-kb-index.py --dry-run        # embed only, do not upload
  python scripts/build-kb-index.py --bucket my-kb   # custom bucket

Environment:
  AWS_REGION  — default: ap-northeast-2
  KB_BUCKET   — default: aigo-kb
  KB_INDEX_KEY — default: vector-index/index.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import re
import sys
import time

import boto3

REPO_ROOT = pathlib.Path(__file__).parent.parent
KB_DOCS_ROOT = REPO_ROOT / "docs" / "kb"

CATEGORY_MAP = {
    "coding-standards":      "coding_standards",
    "infrastructure-standards": "infrastructure",
    "security-policies":     "security",
    "risk-policies":         "risk",
}

# Chunk: max 800 tokens ≈ ~600 words ≈ ~3200 chars; overlap 20%
CHUNK_SIZE  = 2400
CHUNK_OVERLAP = 480


def chunk_text(text: str, source: str) -> list[dict]:
    """Split text into overlapping chunks."""
    text = text.strip()
    if len(text) <= CHUNK_SIZE:
        return [{"text": text, "source": source}]

    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        # Try to break at paragraph boundary
        last_nl = chunk.rfind("\n\n")
        if last_nl > CHUNK_SIZE // 2:
            chunk = chunk[:last_nl]
            end = start + last_nl
        chunks.append({"text": chunk.strip(), "source": source})
        start = end - CHUNK_OVERLAP
    return chunks


def embed_text(client: "boto3.client", text: str) -> list[float] | None:
    try:
        resp = client.invoke_model(
            modelId="amazon.titan-embed-text-v2:0",
            body=json.dumps({"inputText": text[:8000], "dimensions": 1024, "normalize": True}),
            contentType="application/json",
            accept="application/json",
        )
        body = json.loads(resp["body"].read())
        return body.get("embedding")
    except Exception as exc:
        print(f"  [WARN] Embedding failed: {exc}", file=sys.stderr)
        return None


def build_index(dry_run: bool = False, bucket: str = "aigo-kb", index_key: str = "vector-index/index.json"):
    region = os.environ.get("AWS_REGION", "ap-northeast-2")
    bedrock = boto3.client("bedrock-runtime", region_name=region)
    s3      = boto3.client("s3", region_name=region)

    all_chunks: list[dict] = []

    for category_dir, category_tag in CATEGORY_MAP.items():
        cat_path = KB_DOCS_ROOT / category_dir
        if not cat_path.exists():
            print(f"  [SKIP] {cat_path} not found")
            continue

        for md_file in sorted(cat_path.glob("**/*.md")):
            source = str(md_file.relative_to(REPO_ROOT))
            text = md_file.read_text(encoding="utf-8")
            # Strip markdown headers for cleaner embedding
            text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)

            chunks = chunk_text(text, source)
            for c in chunks:
                c["metadata"] = {"category": category_tag, "source": source}
            all_chunks.extend(chunks)
            print(f"  chunked {source}: {len(chunks)} chunk(s)")

    print(f"\nTotal chunks to embed: {len(all_chunks)}")

    index: list[dict] = []
    for i, chunk in enumerate(all_chunks, 1):
        print(f"  [{i:02d}/{len(all_chunks):02d}] embedding {chunk['source'][:60]}...", end="", flush=True)
        t0 = time.time()
        vec = embed_text(bedrock, chunk["text"])
        elapsed = time.time() - t0
        if vec is None:
            print(" FAILED")
            continue
        index.append({
            "id":       f"{chunk['metadata']['category']}_{i:04d}",
            "text":     chunk["text"],
            "embedding": vec,
            "metadata": chunk["metadata"],
        })
        print(f" ok ({elapsed:.1f}s)")
        # Brief rate-limit pause
        time.sleep(0.1)

    print(f"\nEmbedded {len(index)}/{len(all_chunks)} chunks successfully")

    if dry_run:
        # Save locally for inspection
        out = pathlib.Path(".build/kb-index-preview.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(index, indent=2))
        print(f"Dry-run — saved to {out} (NOT uploaded to S3)")
        return

    print(f"\nUploading to s3://{bucket}/{index_key}...")
    s3.put_object(
        Bucket=bucket,
        Key=index_key,
        Body=json.dumps(index).encode(),
        ContentType="application/json",
    )
    size_kb = len(json.dumps(index)) / 1024
    print(f"Uploaded ({size_kb:.1f} KB)")
    print(f"\nDone. Index: s3://{bucket}/{index_key} — {len(index)} chunks, {size_kb:.1f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build KB vector index from docs/kb/")
    parser.add_argument("--dry-run", action="store_true", help="Embed but do not upload to S3")
    parser.add_argument("--bucket", default=os.environ.get("KB_BUCKET", "aigo-kb"), help="S3 bucket name")
    parser.add_argument("--key",    default=os.environ.get("KB_INDEX_KEY", "vector-index/index.json"), help="S3 key for index")
    args = parser.parse_args()
    build_index(dry_run=args.dry_run, bucket=args.bucket, index_key=args.key)
