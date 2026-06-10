#!/usr/bin/env python3
"""
Create the OpenSearch Serverless vector index required by the Bedrock Knowledge Base.

Run this ONCE after `terraform apply` creates the AOSS collection,
and BEFORE the second `terraform apply` that creates the Bedrock KB.

Usage:
  python3 -m venv /tmp/aoss-venv
  /tmp/aoss-venv/bin/pip install boto3 requests requests-aws4auth -q
  /tmp/aoss-venv/bin/python3 infra/scripts/create-aoss-index.py
"""

import sys
import json
import time

try:
    import boto3
    import requests
    from requests_aws4auth import AWS4Auth
except ImportError:
    print("Missing packages. Run:")
    print("  python3 -m venv /tmp/aoss-venv")
    print("  /tmp/aoss-venv/bin/pip install boto3 requests requests-aws4auth -q")
    print("  /tmp/aoss-venv/bin/python3 infra/scripts/create-aoss-index.py")
    sys.exit(1)

REGION         = "ap-northeast-2"
COLLECTION_NAME = "aigo-vectors"
INDEX_NAME     = "aigo-kb-index"

INDEX_BODY = {
    "settings": {
        "index": {"knn": True}
    },
    "mappings": {
        "properties": {
            "embedding": {
                "type": "knn_vector",
                "dimension": 1024,
                "method": {
                    "name": "hnsw",
                    "engine": "faiss",
                    "space_type": "l2"
                }
            },
            "text":     {"type": "text"},
            "metadata": {"type": "text"}
        }
    }
}


def get_collection_endpoint(region: str, name: str) -> str:
    client = boto3.client("opensearchserverless", region_name=region)

    # list_collections returns summary (no endpoint); need batch_get_collection for details
    list_resp = client.list_collections(collectionFilters={"name": name})
    summaries = list_resp.get("collectionSummaries", [])
    if not summaries:
        sys.exit(f"Collection '{name}' not found. Run terraform apply first.")

    status = summaries[0].get("status", "")
    if status != "ACTIVE":
        sys.exit(f"Collection is not ACTIVE yet (status={status}). Wait a minute and retry.")

    collection_id = summaries[0]["id"]
    detail_resp = client.batch_get_collection(ids=[collection_id])
    details = detail_resp.get("collectionDetails", [])
    if not details:
        sys.exit(f"Could not retrieve collection details for '{name}'.")

    return details[0]["collectionEndpoint"]


def build_auth(region: str) -> AWS4Auth:
    session = boto3.Session()
    creds = session.get_credentials().get_frozen_credentials()
    return AWS4Auth(
        creds.access_key,
        creds.secret_key,
        region,
        "aoss",
        session_token=creds.token,
    )


def create_index(endpoint: str, index: str, auth: AWS4Auth) -> None:
    url = f"{endpoint}/{index}"
    headers = {"Content-Type": "application/json"}
    body = json.dumps(INDEX_BODY)

    for attempt in range(1, 7):
        print(f"Attempt {attempt}: PUT {url}")
        try:
            r = requests.put(url, auth=auth, headers=headers, data=body, timeout=30)
            print(f"  → {r.status_code} {r.text[:200]}")

            if r.status_code in (200, 201):
                print("Index created successfully.")
                return
            if r.status_code == 400 and "already_exists" in r.text:
                print("Index already exists — nothing to do.")
                return
            if r.status_code == 403:
                print("  403 Forbidden — check IAM permission (aoss:APIAccessAll)")
                print("  and AOSS data access policy includes your user/role ARN.")

        except Exception as exc:
            print(f"  Error: {exc}")

        if attempt < 6:
            print("  Retrying in 30s...")
            time.sleep(30)

    sys.exit("Failed to create index after 6 attempts.")


if __name__ == "__main__":
    print(f"Region:     {REGION}")
    print(f"Collection: {COLLECTION_NAME}")
    print(f"Index:      {INDEX_NAME}")
    print()

    endpoint = get_collection_endpoint(REGION, COLLECTION_NAME)
    print(f"Endpoint:   {endpoint}")
    print()

    auth = build_auth(REGION)
    create_index(endpoint, INDEX_NAME, auth)
