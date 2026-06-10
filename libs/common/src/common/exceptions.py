from typing import Any


class AigoBaseError(Exception):
    """Base exception for all AgentOps application errors."""

    code: str = "INTERNAL_ERROR"
    http_status: int = 500

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class NotFoundError(AigoBaseError):
    code = "NOT_FOUND"
    http_status = 404


class ValidationError(AigoBaseError):
    code = "VALIDATION_ERROR"
    http_status = 422


class UnauthorizedError(AigoBaseError):
    code = "UNAUTHORIZED"
    http_status = 401


class ForbiddenError(AigoBaseError):
    code = "FORBIDDEN"
    http_status = 403


class ConflictError(AigoBaseError):
    code = "CONFLICT"
    http_status = 409


class ExternalServiceError(AigoBaseError):
    code = "EXTERNAL_SERVICE_ERROR"
    http_status = 502

    def __init__(self, service: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(f"{service}: {message}", details)
        self.service = service
