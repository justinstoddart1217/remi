"""Ninety One accent defaults: the redesign's teal and blue replace the olive and indigo stand-ins.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25

- ``settings.accent_pc`` / ``settings.accent_fi``: the server defaults become ``#009D80`` /
  ``#2F6B9A``, the redesign's default ``accents`` pair (Remi.dc.html, section "Brand").
- The settings row: a pair that is still one of the four pre-redesign stand-ins (the old
  default ``#526e2a`` / ``#47619c`` and the three others the picker offered) takes the new default
  pair. Matching ignores case. Any other pair, set through the API, stays as it is.

SQLite cannot change a column default in place, so the table is rebuilt in batch mode from its
definition at ``0003`` (``copy_from``: this works offline too, and it keeps every CHECK
constraint, foreign key and name exactly as they are). The settings table has not changed
since ``0001``.

Migrations must not import ``app``: they describe the schema as it was at this revision.
"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_DEFAULT: Final = ("#526e2a", "#47619c")
NEW_DEFAULT: Final = ("#009D80", "#2F6B9A")
OLD_STANDINS: Final = (
    OLD_DEFAULT,
    ("#00737e", "#5e5a9a"),
    ("#1f744f", "#32669a"),
    ("#884b75", "#007187"),
)


def _settings(accent_pc: str, accent_fi: str) -> sa.Table:
    """The ``settings`` table as ``0001`` created it, with these accent server defaults."""
    return sa.Table(
        "settings",
        sa.MetaData(),
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("timezone", sa.String(length=64), server_default="Europe/London", nullable=False),
        sa.Column("holiday_region", sa.String(length=16), server_default="GB-ENG", nullable=False),
        sa.Column("move_date", sa.Date(), nullable=True),
        sa.Column("move_taper", sa.String(length=8), server_default="hard", nullable=False),
        sa.Column(
            "capacity_hours_per_day", sa.Float(), server_default=sa.text("8"), nullable=False
        ),
        sa.Column(
            "stale_threshold_days", sa.Integer(), server_default=sa.text("7"), nullable=False
        ),
        sa.Column(
            "overload_lookahead_bd", sa.Integer(), server_default=sa.text("10"), nullable=False
        ),
        sa.Column(
            "new_project_horizon_bd", sa.Integer(), server_default=sa.text("30"), nullable=False
        ),
        sa.Column("now_ms_offset_bd", sa.Integer(), server_default=sa.text("9"), nullable=False),
        sa.Column("next_ms_offset_bd", sa.Integer(), server_default=sa.text("20"), nullable=False),
        sa.Column("key_project_id", sa.String(length=36), nullable=True),
        sa.Column("key_routine_id", sa.String(length=36), nullable=True),
        sa.Column("key_run_date_override", sa.Date(), nullable=True),
        sa.Column(
            "motion_preference", sa.String(length=8), server_default="system", nullable=False
        ),
        sa.Column("accent_pc", sa.String(length=64), server_default=accent_pc, nullable=False),
        sa.Column("accent_fi", sa.String(length=64), server_default=accent_fi, nullable=False),
        sa.Column("serif_display", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("ai_provider", sa.String(length=16), server_default="none", nullable=False),
        sa.Column("ai_model", sa.String(length=120), nullable=True),
        sa.Column(
            "ai_send_recent_notes", sa.Boolean(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "ollama_base_url",
            sa.String(length=255),
            server_default="http://127.0.0.1:11434",
            nullable=False,
        ),
        sa.Column("ai_timeout_s", sa.Float(), nullable=True),
        sa.Column("ai_server_fallback", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "ai_audit_retention_days", sa.Integer(), server_default=sa.text("90"), nullable=False
        ),
        sa.Column("ui_prefs", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("setup_completed_at", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint(
            '"ai_audit_retention_days" >= 1', name=op.f("ck_settings_ai_audit_retention_days_range")
        ),
        sa.CheckConstraint(
            "\"ai_provider\" IN ('none', 'anthropic', 'ollama')",
            name=op.f("ck_settings_ai_provider_valid"),
        ),
        sa.CheckConstraint(
            '"ai_timeout_s" IS NULL OR ("ai_timeout_s" >= 1 AND "ai_timeout_s" <= 600)',
            name=op.f("ck_settings_ai_timeout_s_range"),
        ),
        sa.CheckConstraint(
            '"capacity_hours_per_day" >= 1 AND "capacity_hours_per_day" <= 24',
            name=op.f("ck_settings_capacity_hours_per_day_range"),
        ),
        sa.CheckConstraint(
            "\"holiday_region\" IN ('GB-ENG', 'ZA')", name=op.f("ck_settings_holiday_region_valid")
        ),
        sa.CheckConstraint(
            "\"motion_preference\" IN ('system', 'full', 'reduced')",
            name=op.f("ck_settings_motion_preference_valid"),
        ),
        sa.CheckConstraint(
            "\"move_taper\" IN ('hard', 'taper')", name=op.f("ck_settings_move_taper_valid")
        ),
        sa.CheckConstraint(
            '"new_project_horizon_bd" >= 1', name=op.f("ck_settings_new_project_horizon_bd_range")
        ),
        sa.CheckConstraint(
            '"next_ms_offset_bd" >= 0', name=op.f("ck_settings_next_ms_offset_bd_range")
        ),
        sa.CheckConstraint(
            '"now_ms_offset_bd" >= 0', name=op.f("ck_settings_now_ms_offset_bd_range")
        ),
        sa.CheckConstraint(
            '"overload_lookahead_bd" >= 0', name=op.f("ck_settings_overload_lookahead_bd_range")
        ),
        sa.CheckConstraint(
            '"stale_threshold_days" >= 1', name=op.f("ck_settings_stale_threshold_days_range")
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_settings_singleton")),
        sa.ForeignKeyConstraint(
            ["key_project_id"],
            ["projects.id"],
            name=op.f("fk_settings_key_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["key_routine_id"],
            ["routines.id"],
            name=op.f("fk_settings_key_routine_id_routines"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings")),
    )


def _set_accent_defaults(current: tuple[str, str], new: tuple[str, str]) -> None:
    with op.batch_alter_table(
        "settings", schema=None, copy_from=_settings(*current), recreate="always"
    ) as batch_op:
        for column, default in zip(("accent_pc", "accent_fi"), new, strict=True):
            batch_op.alter_column(
                column,
                existing_type=sa.String(length=64),
                existing_nullable=False,
                server_default=default,
            )


def _rewrite_pairs(pairs: Sequence[tuple[str, str]], to: tuple[str, str]) -> None:
    """Sets the row's accents to ``to`` where its pair, ignoring case, is one of ``pairs``."""
    settings = sa.table(
        "settings", sa.column("accent_pc", sa.String()), sa.column("accent_fi", sa.String())
    )
    pair = sa.func.lower(settings.c.accent_pc) + " " + sa.func.lower(settings.c.accent_fi)
    op.execute(
        settings.update()
        .where(pair.in_([f"{pc.lower()} {fi.lower()}" for pc, fi in pairs]))
        .values(accent_pc=to[0], accent_fi=to[1])
    )


def upgrade() -> None:
    _set_accent_defaults(OLD_DEFAULT, NEW_DEFAULT)
    _rewrite_pairs(OLD_STANDINS, NEW_DEFAULT)


def downgrade() -> None:
    # Only the default pair goes back: the other stand-ins 0004 rewrote cannot be told apart.
    _set_accent_defaults(NEW_DEFAULT, OLD_DEFAULT)
    _rewrite_pairs([NEW_DEFAULT], OLD_DEFAULT)
