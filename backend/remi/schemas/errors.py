"""The one error envelope every ``/api`` failure uses: ``{"error": {code, message, field}}``."""

from remi.schemas.base import CamelModel


class ErrorBody(CamelModel):
    code: str
    """Stable machine code, e.g. ``SETUP_REQUIRED``. See ``docs/api.md`` for the catalogue."""
    message: str
    """Human-readable detail. Never contains secrets."""
    field: str | None = None
    """The offending request field (camelCase, dotted for nesting), when there is one."""


class ErrorOut(CamelModel):
    error: ErrorBody


ERROR_CODES: dict[str, str] = {
    "VALIDATION_ERROR": "422. A request field failed schema validation; `field` names it.",
    "VALIDATION_FAILED": "422. A service rejected a value (domain rule); `field` names it.",
    "NOT_FOUND": "404. Unknown `/api` path or entity id.",
    "METHOD_NOT_ALLOWED": "405. The path exists but not with this method.",
    "NOT_IMPLEMENTED": "501. The route is in the contract but its service is not built yet.",
    "SETUP_REQUIRED": "409. First-run setup is not complete, so there is no move date yet.",
    "SETUP_ALREADY_DONE": "409. `POST /setup` after setup completed (use `PATCH /settings`).",
    "CONFLICT": "409. Generic state conflict.",
    "DOMAIN_ERROR": "400. Generic domain failure (a `DomainError` without a specific code).",
    "VERSION_CONFLICT": "409. Textbook `baseVersion` is stale; refetch the page.",
    "SECTION_NOT_EMPTY": "409. Only empty textbook sections can be deleted.",
    "LAST_SECTION": "409. The last textbook section cannot be deleted.",
    "NOT_AN_OCCURRENCE": "422. The routine does not run on that date.",
    "RUN_NOT_EDITABLE": "409. Checklist ticks are only editable for today's run.",
    "OUT_OF_RANGE": "422. A date is outside the supported calendar (1990 to 2100).",
    "UNSUPPORTED_MEDIA_TYPE": "415. Chart uploads must be .html/.htm UTF-8 text.",
    "PAYLOAD_TOO_LARGE": "413. Chart upload over the size limit (4 MB).",
    "AI_NOT_CONFIGURED": "409. The chosen provider has no key, SDK or reachable Ollama.",
    "AI_AUTH": "502. The provider rejected the key.",
    "AI_BAD_REPLY": "502. The provider replied without a usable proposal.",
    "AI_UNAVAILABLE": "502. The provider could not be reached.",
    "AI_RATE_LIMITED": "503. The provider is rate limiting.",
    "AI_TIMEOUT": "504. The provider did not answer in time.",
    "PARSE_CANCELLED": "409. The parse was cancelled (`DELETE /checkins/parse/{parseId}`).",
    "FORBIDDEN_ORIGIN": "403. Mutating call without a loopback `Origin`.",
    "CLIENT_HEADER_REQUIRED": "403. Mutating call without `X-Remi-Client: 1`.",
    "INTERNAL_ERROR": "500. Unexpected server error; details are only in the server log.",
}
"""Every error code the API emits, with its HTTP status. Services may add codes; list them here."""
