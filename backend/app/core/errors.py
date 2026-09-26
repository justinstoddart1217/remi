"""Domain errors.

Services raise these; ``api/errors.py`` maps any :class:`DomainError` to
``{"error": {"code", "message", "field"?}}`` with :attr:`DomainError.status`.
Anything else that escapes a service is a bug and becomes a 500.
"""

from typing import Any, ClassVar


class DomainError(Exception):
    """A failure the user can act on. ``field`` names the offending input, if any."""

    default_code: ClassVar[str] = "DOMAIN_ERROR"
    default_status: ClassVar[int] = 400

    code: str
    message: str
    field: str | None
    status: int

    def __init__(
        self,
        code: str,
        message: str,
        field: str | None = None,
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field
        self.status = status if status is not None else self.default_status

    def to_dict(self) -> dict[str, Any]:
        """The ``error`` object of the JSON error body."""
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.field is not None:
            body["field"] = self.field
        return body

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}(code={self.code!r}, message={self.message!r}, "
            f"field={self.field!r}, status={self.status})"
        )


class _PresetError(DomainError):
    """A subclass with a fixed status and a default code: ``Sub(message, field=None)``."""

    default_message: ClassVar[str] = "Request failed."

    def __init__(
        self,
        message: str | None = None,
        field: str | None = None,
        *,
        code: str | None = None,
    ) -> None:
        super().__init__(
            code if code is not None else self.default_code,
            message if message is not None else self.default_message,
            field,
            self.default_status,
        )


class NotFound(_PresetError):
    default_code = "NOT_FOUND"
    default_status = 404
    default_message = "Not found."


class Conflict(_PresetError):
    default_code = "CONFLICT"
    default_status = 409
    default_message = "That conflicts with the current state."


class VersionConflict(Conflict):
    """Optimistic-lock failure (Textbook page blocks saved against a stale version)."""

    default_code = "VERSION_CONFLICT"
    default_message = "This page changed somewhere else. Reload to see the latest version."


class SetupRequired(Conflict):
    """Reads that need the move date before first-run setup has completed."""

    default_code = "SETUP_REQUIRED"
    default_message = "Finish setup first."


class ValidationFailed(_PresetError):
    default_code = "VALIDATION_FAILED"
    default_status = 422
    default_message = "That value is not valid."


class OutOfRange(_PresetError):
    """A date or value outside what Remi supports (e.g. beyond the holiday horizon)."""

    default_code = "OUT_OF_RANGE"
    default_status = 422
    default_message = "That is outside the supported range."
