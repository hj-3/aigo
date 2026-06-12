"""
GitHub App authentication helpers.
Creates installation access tokens for GitHub API calls.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt


def create_installation_token(app_id: str, private_key: str, installation_id: str) -> str:
    """
    Creates a GitHub App installation access token.

    1. Signs a JWT with the app's RSA private key
    2. Exchanges the JWT for an installation access token
    """
    # Build JWT (valid for 10 min, GitHub requires < 10 min)
    now = int(time.time())
    payload = {
        "iat": now - 60,  # backdate 60s to account for clock skew
        "exp": now + 540,  # 9 minutes
        "iss": str(app_id),
    }

    # Handle PEM key — may be stored with literal \n in JSON
    pem_key = private_key.replace("\\n", "\n")
    app_jwt = jwt.encode(payload, pem_key, algorithm="RS256")

    # Exchange JWT for installation token
    resp = httpx.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers={
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data: dict[str, Any] = resp.json()
    return data["token"]
