from datetime import UTC, datetime


def utcnow_iso() -> str:
    """Return current UTC time as ISO 8601 string with millisecond precision."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def utcnow_timestamp() -> int:
    """Return current UTC time as Unix timestamp (seconds)."""
    return int(datetime.now(tz=UTC).timestamp())


def ttl_seconds(days: int) -> int:
    """Return a Unix TTL timestamp `days` days from now."""
    return utcnow_timestamp() + (days * 86400)
