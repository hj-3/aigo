from datetime import UTC, datetime

import ulid


def new_ulid() -> str:
    """Generate a new ULID string (lexicographically sortable, time-prefixed)."""
    return str(ulid.new())


def ulid_to_datetime(ulid_str: str) -> datetime:
    """Extract the timestamp embedded in a ULID string."""
    return ulid.from_str(ulid_str).timestamp().datetime.replace(tzinfo=UTC)
