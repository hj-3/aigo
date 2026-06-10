"""ECS Fargate task entrypoint."""
import sys
import structlog

from .handler import run

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO
    logger_factory=structlog.PrintLoggerFactory(),
)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception:
        structlog.get_logger().exception("Fatal error in heavy worker")
        sys.exit(1)
