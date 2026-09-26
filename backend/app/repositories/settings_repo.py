"""``SettingsRepository``: the singleton ``settings`` row (``id = 1``).

Migration ``0001`` inserts the row, so ``get()`` normally just loads it; it recreates the row
with its defaults if it is ever missing. API keys are never stored here.
"""

from collections.abc import Mapping
from typing import Any, Final

from sqlalchemy.orm import Session

from app.repositories.models import SETTINGS_ID, Settings

_NOT_WRITABLE: Final = frozenset({"id", "created_at", "updated_at"})


def _writable_columns() -> frozenset[str]:
    return frozenset(
        prop.key
        for prop in Settings.__mapper__.column_attrs  # pyright: ignore[reportUnknownMemberType]
        if prop.key not in _NOT_WRITABLE
    )


SETTINGS_FIELDS: Final = _writable_columns()
"""Attribute names ``update()`` accepts."""


def _default_value(key: str) -> Any:
    column = Settings.__table__.c[key]
    default = column.default
    if default is None:
        return None
    if getattr(default, "is_scalar", False):
        return getattr(default, "arg", None)
    return None


class SettingsRepository:
    """Read and change the one settings row."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self) -> Settings:
        """The settings row (created with its defaults if missing)."""
        row = self.session.get(Settings, SETTINGS_ID)
        if row is None:
            row = Settings(id=SETTINGS_ID, ui_prefs={})
            self.session.add(row)
            self.session.flush()
        return row

    def update(self, **fields: Any) -> Settings:
        """Set the given attributes. Unknown names raise ``ValueError``."""
        return self.update_from(fields)

    def update_from(self, fields: Mapping[str, Any]) -> Settings:
        row = self.get()
        unknown = set(fields) - SETTINGS_FIELDS
        if unknown:
            msg = f"unknown settings field(s): {', '.join(sorted(unknown))}"
            raise ValueError(msg)
        for key, value in fields.items():
            if getattr(row, key) != value:
                setattr(row, key, value)
        return row

    def reset(self) -> Settings:
        """Every field back to its default (setup not done). Used by dev fixtures."""
        row = self.get()
        for key in SETTINGS_FIELDS:
            value: Any = {} if key == "ui_prefs" else _default_value(key)
            if getattr(row, key) != value:
                setattr(row, key, value)
        return row

    def is_setup_complete(self) -> bool:
        row = self.get()
        return row.setup_completed_at is not None and row.move_date is not None
