import logging
import os
from typing import Any

import structlog


def _configure_structlog() -> None:
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, log_level, logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level, logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


_configured = False


def get_logger(name: str = "aigo") -> structlog.BoundLogger:
    global _configured  # noqa: PLW0603
    if not _configured:
        _configure_structlog()
        _configured = True
    return structlog.get_logger(name).bind(
        service=os.environ.get("SERVICE_NAME", name),
        region=os.environ.get("AWS_REGION", "ap-northeast-2"),
        stage=os.environ.get("STAGE", "prod"),
    )


def get_context_logger(context: dict[str, Any], name: str = "aigo") -> structlog.BoundLogger:
    """Returns a logger pre-bound with structured context fields."""
    return get_logger(name).bind(**context)
