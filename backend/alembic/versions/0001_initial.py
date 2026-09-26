"""Initial schema: every table, the append-only triggers and the settings row.

Revision ID: 0001
Revises:
Create Date: 2026-09-24

Migrations must not import ``app``: they describe the schema as it was at this revision.
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APPEND_ONLY_TRIGGERS = (
    "CREATE TRIGGER remi_events_no_update BEFORE UPDATE ON remi_events "
    "BEGIN SELECT RAISE(ABORT, 'remi_events is append-only'); END",
    "CREATE TRIGGER remi_events_no_delete BEFORE DELETE ON remi_events "
    "BEGIN SELECT RAISE(ABORT, 'remi_events is append-only'); END",
)


def upgrade() -> None:
    op.create_table(
        "ai_audit",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("parse_id", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("context_json", sa.JSON(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("response_raw", sa.Text(), nullable=True),
        sa.Column("proposal_json", sa.JSON(), nullable=True),
        sa.Column("dropped_json", sa.JSON(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_code", sa.String(length=32), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_audit")),
    )
    with op.batch_alter_table("ai_audit", schema=None) as batch_op:
        batch_op.create_index("ix_ai_audit_created_at", ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_ai_audit_parse_id"), ["parse_id"], unique=False)

    op.create_table(
        "chart_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_relpath", sa.String(length=255), nullable=False),
        sa.Column("uploaded_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint('"size_bytes" >= 0', name=op.f("ck_chart_assets_size_bytes_range")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chart_assets")),
        sa.UniqueConstraint("content_hash", name=op.f("uq_chart_assets_content_hash")),
    )
    op.create_table(
        "holiday_years",
        sa.Column("region", sa.String(length=16), nullable=False),
        sa.Column("year", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("package_version", sa.String(length=32), nullable=False),
        sa.Column("generated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint(
            "\"region\" IN ('GB-ENG', 'ZA')", name=op.f("ck_holiday_years_region_valid")
        ),
        sa.CheckConstraint(
            '"year" >= 1900 AND "year" <= 2200', name=op.f("ck_holiday_years_year_range")
        ),
        sa.PrimaryKeyConstraint("region", "year", name=op.f("pk_holiday_years")),
    )
    op.create_table(
        "holidays",
        sa.Column("region", sa.String(length=16), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("suppressed", sa.Boolean(), nullable=False),
        sa.CheckConstraint("\"region\" IN ('GB-ENG', 'ZA')", name=op.f("ck_holidays_region_valid")),
        sa.CheckConstraint(
            "\"source\" IN ('generated', 'manual')", name=op.f("ck_holidays_source_valid")
        ),
        sa.PrimaryKeyConstraint("region", "date", name=op.f("pk_holidays")),
    )
    op.create_table(
        "leave_days",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.CheckConstraint(
            '"hours" IS NULL OR ("hours" >= 0 AND "hours" <= 24)',
            name=op.f("ck_leave_days_hours_range"),
        ),
        sa.PrimaryKeyConstraint("date", name=op.f("pk_leave_days")),
    )
    op.create_table(
        "notes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
    )
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.create_index("ix_notes_day_seq", ["day", "seq"], unique=False)

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("domain", sa.String(length=2), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("short", sa.String(length=80), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("why_now", sa.Text(), nullable=False),
        sa.Column("later_intent", sa.Text(), nullable=False),
        sa.Column("end_name", sa.String(length=80), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("target_label", sa.String(length=80), nullable=True),
        sa.Column("forecast_date", sa.Date(), nullable=True),
        sa.Column("prev_forecast_date", sa.Date(), nullable=True),
        sa.Column("rate_hours_per_day", sa.Float(), nullable=False),
        sa.Column("rate_after_move", sa.Float(), nullable=False),
        sa.Column("baseline_hours", sa.Float(), nullable=False),
        sa.Column("unplaced_hours", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("last_checkin_date", sa.Date(), nullable=True),
        sa.Column("blocker", sa.Text(), nullable=True),
        sa.Column("readiness", sa.Float(), nullable=True),
        sa.Column("after_day_one_note", sa.Text(), nullable=True),
        sa.Column("phase", sa.Integer(), nullable=False),
        sa.Column("exit_routes", sa.JSON(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint('"baseline_hours" >= 0', name=op.f("ck_projects_baseline_hours_range")),
        sa.CheckConstraint(
            '"confidence" IS NULL OR ("confidence" >= 1 AND "confidence" <= 5)',
            name=op.f("ck_projects_confidence_range"),
        ),
        sa.CheckConstraint("\"domain\" IN ('pc', 'fi')", name=op.f("ck_projects_domain_valid")),
        sa.CheckConstraint('"phase" >= 0 AND "phase" <= 3', name=op.f("ck_projects_phase_range")),
        sa.CheckConstraint(
            '"rate_after_move" >= 0 AND "rate_after_move" <= 24',
            name=op.f("ck_projects_rate_after_move_range"),
        ),
        sa.CheckConstraint(
            '"rate_hours_per_day" >= 0 AND "rate_hours_per_day" <= 24',
            name=op.f("ck_projects_rate_hours_per_day_range"),
        ),
        sa.CheckConstraint(
            '"readiness" IS NULL OR ("readiness" >= 0 AND "readiness" <= 1)',
            name=op.f("ck_projects_readiness_range"),
        ),
        sa.CheckConstraint('"unplaced_hours" >= 0', name=op.f("ck_projects_unplaced_hours_range")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.create_index(
            "ix_projects_domain_sort_order", ["domain", "sort_order"], unique=False
        )

    op.create_table(
        "remi_events",
        sa.Column("seq", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("at", sa.String(length=32), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=32), nullable=False),
        sa.Column("refs", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "\"actor\" IN ('user', 'ai-proposal-accepted', 'simple-proposal-accepted', 'setup', 'system', 'import')",
            name=op.f("ck_remi_events_actor_valid"),
        ),
        sa.PrimaryKeyConstraint("seq", name=op.f("pk_remi_events")),
        sa.UniqueConstraint("id", name=op.f("uq_remi_events_id")),
        sqlite_autoincrement=True,
    )
    with op.batch_alter_table("remi_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_remi_events_type"), ["type"], unique=False)
    for statement in APPEND_ONLY_TRIGGERS:
        op.execute(statement)

    op.create_table(
        "rotations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("domain", sa.String(length=2), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("hours_per_day", sa.Float(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint("\"domain\" IN ('pc', 'fi')", name=op.f("ck_rotations_domain_valid")),
        sa.CheckConstraint(
            '"hours_per_day" >= 0 AND "hours_per_day" <= 24',
            name=op.f("ck_rotations_hours_per_day_range"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rotations")),
    )
    op.create_table(
        "textbook_sections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("accent", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("collapsed", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_textbook_sections")),
    )
    op.create_table(
        "charter_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("list", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "\"list\" IN ('success', 'inScope', 'outScope', 'constraints')",
            name=op.f("ck_charter_items_list_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_charter_items_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_charter_items")),
    )
    with op.batch_alter_table("charter_items", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_charter_items_project_id"), ["project_id"], unique=False
        )

    op.create_table(
        "checkins",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("batch_id", sa.String(length=36), nullable=True),
        sa.Column("parse_id", sa.String(length=64), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("forecast_date", sa.Date(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("blockers", sa.Text(), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("done_task_ids", sa.JSON(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint(
            '"confidence" IS NULL OR ("confidence" >= 1 AND "confidence" <= 5)',
            name=op.f("ck_checkins_confidence_range"),
        ),
        sa.CheckConstraint(
            "\"source\" IN ('ai', 'simple', 'form', 'system')",
            name=op.f("ck_checkins_source_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_checkins_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_checkins")),
    )
    with op.batch_alter_table("checkins", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_checkins_batch_id"), ["batch_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_checkins_project_id"), ["project_id"], unique=False)

    op.create_table(
        "checklists",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_checklists_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_checklists")),
    )
    with op.batch_alter_table("checklists", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_checklists_project_id"), ["project_id"], unique=False)

    op.create_table(
        "hour_overrides",
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.CheckConstraint(
            '"hours" >= 0 AND "hours" <= 24', name=op.f("ck_hour_overrides_hours_range")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_hour_overrides_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "date", name=op.f("pk_hour_overrides")),
    )
    op.create_table(
        "milestones",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("horizon", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.CheckConstraint(
            "\"horizon\" IN ('now', 'next', 'explicit')", name=op.f("ck_milestones_horizon_valid")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_milestones_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_milestones")),
    )
    with op.batch_alter_table("milestones", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_milestones_project_id"), ["project_id"], unique=False)

    op.create_table(
        "readiness_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_readiness_items_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_readiness_items")),
    )
    with op.batch_alter_table("readiness_items", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_readiness_items_project_id"), ["project_id"], unique=False
        )

    op.create_table(
        "risks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("risk", sa.Text(), nullable=False),
        sa.Column("mitigation", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_risks_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_risks")),
    )
    with op.batch_alter_table("risks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_risks_project_id"), ["project_id"], unique=False)

    op.create_table(
        "rotation_segments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("rotation_id", sa.String(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("country", sa.String(length=80), nullable=False),
        sa.Column("code", sa.String(length=8), nullable=False),
        sa.Column("length_bd", sa.Integer(), nullable=False),
        sa.Column("pass", sa.String(length=8), nullable=False),
        sa.Column("loop", sa.Integer(), nullable=False),
        sa.CheckConstraint('"length_bd" >= 1', name=op.f("ck_rotation_segments_length_bd_range")),
        sa.CheckConstraint('"loop" >= 1', name=op.f("ck_rotation_segments_loop_range")),
        sa.CheckConstraint(
            "\"pass\" IN ('Build', 'Refresh')", name=op.f("ck_rotation_segments_pass_valid")
        ),
        sa.ForeignKeyConstraint(
            ["rotation_id"],
            ["rotations.id"],
            name=op.f("fk_rotation_segments_rotation_id_rotations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rotation_segments")),
    )
    with op.batch_alter_table("rotation_segments", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_rotation_segments_rotation_id"), ["rotation_id"], unique=False
        )

    op.create_table(
        "routines",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("domain", sa.String(length=2), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("short", sa.String(length=80), nullable=False),
        sa.Column("detail", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("bd", sa.Integer(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.Column("stage", sa.Integer(), nullable=False),
        sa.Column("status_note", sa.Text(), nullable=False),
        sa.Column("transition_note", sa.Text(), nullable=True),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("co_tag_with_project", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint('"bd" >= 1 AND "bd" <= 20', name=op.f("ck_routines_bd_range")),
        sa.CheckConstraint("\"domain\" IN ('pc', 'fi')", name=op.f("ck_routines_domain_valid")),
        sa.CheckConstraint('"hours" >= 0 AND "hours" <= 24', name=op.f("ck_routines_hours_range")),
        sa.CheckConstraint(
            "\"kind\" IN ('monthly', 'weekly', 'daily')", name=op.f("ck_routines_kind_valid")
        ),
        sa.CheckConstraint('"stage" >= 0 AND "stage" <= 3', name=op.f("ck_routines_stage_range")),
        sa.CheckConstraint(
            '"weekday" >= 1 AND "weekday" <= 5', name=op.f("ck_routines_weekday_range")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_routines_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routines")),
    )
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_routines_project_id"), ["project_id"], unique=False)

    op.create_table(
        "textbook_pages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("parent_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.CheckConstraint('"version" >= 1', name=op.f("ck_textbook_pages_version_range")),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["textbook_pages.id"],
            name=op.f("fk_textbook_pages_parent_id_textbook_pages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["section_id"],
            ["textbook_sections.id"],
            name=op.f("fk_textbook_pages_section_id_textbook_sections"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_textbook_pages")),
    )
    with op.batch_alter_table("textbook_pages", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_textbook_pages_parent_id"), ["parent_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_textbook_pages_section_id"), ["section_id"], unique=False
        )

    op.create_table(
        "checklist_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("checklist_id", sa.String(length=36), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["checklist_id"],
            ["checklists.id"],
            name=op.f("fk_checklist_items_checklist_id_checklists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_checklist_items")),
    )
    with op.batch_alter_table("checklist_items", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_checklist_items_checklist_id"), ["checklist_id"], unique=False
        )

    op.create_table(
        "entity_aliases",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("routine_id", sa.String(length=36), nullable=True),
        sa.Column("alias", sa.String(length=120), nullable=False),
        sa.CheckConstraint(
            "(project_id IS NULL) <> (routine_id IS NULL)",
            name=op.f("ck_entity_aliases_one_entity"),
        ),
        sa.CheckConstraint(
            "alias = lower(alias) AND length(trim(alias)) > 0",
            name=op.f("ck_entity_aliases_alias_lower"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_entity_aliases_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_entity_aliases_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entity_aliases")),
        sa.UniqueConstraint("project_id", "alias", name=op.f("uq_entity_aliases_project_id_alias")),
        sa.UniqueConstraint("routine_id", "alias", name=op.f("uq_entity_aliases_routine_id_alias")),
    )
    with op.batch_alter_table("entity_aliases", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_entity_aliases_project_id"), ["project_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_entity_aliases_routine_id"), ["routine_id"], unique=False
        )

    op.create_table(
        "feed_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("routine_id", sa.String(length=36), nullable=True),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("delta", sa.String(length=32), nullable=False),
        sa.Column("tone", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_feed_events_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_feed_events_routine_id_routines"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feed_events")),
    )
    with op.batch_alter_table("feed_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_feed_events_project_id"), ["project_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_feed_events_routine_id"), ["routine_id"], unique=False)

    op.create_table(
        "project_bau_day_hours",
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("routine_id", sa.String(length=36), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.CheckConstraint(
            '"hours" >= 0 AND "hours" <= 24', name=op.f("ck_project_bau_day_hours_hours_range")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_bau_day_hours_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_project_bau_day_hours_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "routine_id", name=op.f("pk_project_bau_day_hours")),
    )
    with op.batch_alter_table("project_bau_day_hours", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_project_bau_day_hours_routine_id"), ["routine_id"], unique=False
        )

    op.create_table(
        "routine_checklist_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("routine_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_routine_checklist_items_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_checklist_items")),
    )
    with op.batch_alter_table("routine_checklist_items", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_routine_checklist_items_routine_id"), ["routine_id"], unique=False
        )

    op.create_table(
        "routine_runs",
        sa.Column("routine_id", sa.String(length=36), nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_routine_runs_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("routine_id", "occurrence_date", name=op.f("pk_routine_runs")),
    )
    op.create_table(
        "scope_changes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("checkin_id", sa.String(length=36), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("what", sa.Text(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.Column("slip_bd", sa.Integer(), nullable=False),
        sa.Column("from_forecast", sa.Date(), nullable=True),
        sa.Column("to_forecast", sa.Date(), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["checkin_id"],
            ["checkins.id"],
            name=op.f("fk_scope_changes_checkin_id_checkins"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_scope_changes_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scope_changes")),
    )
    with op.batch_alter_table("scope_changes", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_scope_changes_checkin_id"), ["checkin_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_scope_changes_project_id"), ["project_id"], unique=False
        )

    op.create_table(
        "settings",
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
        sa.Column("accent_pc", sa.String(length=64), server_default="#526e2a", nullable=False),
        sa.Column("accent_fi", sa.String(length=64), server_default="#47619c", nullable=False),
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
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("milestone_id", sa.String(length=36), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.CheckConstraint('"hours" >= 0', name=op.f("ck_tasks_hours_range")),
        sa.ForeignKeyConstraint(
            ["milestone_id"],
            ["milestones.id"],
            name=op.f("fk_tasks_milestone_id_milestones"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_tasks_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_tasks_milestone_id"), ["milestone_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_tasks_project_id"), ["project_id"], unique=False)

    op.create_table(
        "textbook_blocks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("page_id", sa.String(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("target_page_id", sa.String(length=36), nullable=True),
        sa.Column("chart_asset_id", sa.String(length=36), nullable=True),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("caption", sa.Text(), nullable=False),
        sa.CheckConstraint(
            '"height" >= 200 AND "height" <= 900', name=op.f("ck_textbook_blocks_height_range")
        ),
        sa.CheckConstraint(
            "\"type\" IN ('p', 'h1', 'h2', 'h3', 'bullet', 'callout', 'formula', 'page', 'chart', 'divider')",
            name=op.f("ck_textbook_blocks_type_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["chart_asset_id"],
            ["chart_assets.id"],
            name=op.f("fk_textbook_blocks_chart_asset_id_chart_assets"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["page_id"],
            ["textbook_pages.id"],
            name=op.f("fk_textbook_blocks_page_id_textbook_pages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_page_id"],
            ["textbook_pages.id"],
            name=op.f("fk_textbook_blocks_target_page_id_textbook_pages"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_textbook_blocks")),
    )
    with op.batch_alter_table("textbook_blocks", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_textbook_blocks_chart_asset_id"), ["chart_asset_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_textbook_blocks_page_id"), ["page_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_textbook_blocks_target_page_id"), ["target_page_id"], unique=False
        )

    op.create_table(
        "routine_run_ticks",
        sa.Column("routine_id", sa.String(length=36), nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("done_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["routine_checklist_items.id"],
            name=op.f("fk_routine_run_ticks_item_id_routine_checklist_items"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_routine_run_ticks_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "routine_id", "occurrence_date", "item_id", name=op.f("pk_routine_run_ticks")
        ),
    )
    with op.batch_alter_table("routine_run_ticks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_routine_run_ticks_item_id"), ["item_id"], unique=False)

    # The settings singleton, with every column at its server default. Setup is still
    # required (setup_completed_at IS NULL) and the AI provider is "none".
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    settings = sa.table(
        "settings",
        sa.column("id", sa.Integer()),
        sa.column("created_at", sa.String()),
        sa.column("updated_at", sa.String()),
    )
    op.bulk_insert(settings, [{"id": 1, "created_at": now, "updated_at": now}])


def downgrade() -> None:
    with op.batch_alter_table("routine_run_ticks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_routine_run_ticks_item_id"))

    op.drop_table("routine_run_ticks")
    with op.batch_alter_table("textbook_blocks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_textbook_blocks_target_page_id"))
        batch_op.drop_index(batch_op.f("ix_textbook_blocks_page_id"))
        batch_op.drop_index(batch_op.f("ix_textbook_blocks_chart_asset_id"))

    op.drop_table("textbook_blocks")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_tasks_project_id"))
        batch_op.drop_index(batch_op.f("ix_tasks_milestone_id"))

    op.drop_table("tasks")
    op.drop_table("settings")
    with op.batch_alter_table("scope_changes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_scope_changes_project_id"))
        batch_op.drop_index(batch_op.f("ix_scope_changes_checkin_id"))

    op.drop_table("scope_changes")
    op.drop_table("routine_runs")
    with op.batch_alter_table("routine_checklist_items", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_routine_checklist_items_routine_id"))

    op.drop_table("routine_checklist_items")
    with op.batch_alter_table("project_bau_day_hours", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_project_bau_day_hours_routine_id"))

    op.drop_table("project_bau_day_hours")
    with op.batch_alter_table("feed_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_feed_events_routine_id"))
        batch_op.drop_index(batch_op.f("ix_feed_events_project_id"))

    op.drop_table("feed_events")
    with op.batch_alter_table("entity_aliases", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_entity_aliases_routine_id"))
        batch_op.drop_index(batch_op.f("ix_entity_aliases_project_id"))

    op.drop_table("entity_aliases")
    with op.batch_alter_table("checklist_items", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_checklist_items_checklist_id"))

    op.drop_table("checklist_items")
    with op.batch_alter_table("textbook_pages", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_textbook_pages_section_id"))
        batch_op.drop_index(batch_op.f("ix_textbook_pages_parent_id"))

    op.drop_table("textbook_pages")
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_routines_project_id"))

    op.drop_table("routines")
    with op.batch_alter_table("rotation_segments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_rotation_segments_rotation_id"))

    op.drop_table("rotation_segments")
    with op.batch_alter_table("risks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_risks_project_id"))

    op.drop_table("risks")
    with op.batch_alter_table("readiness_items", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_readiness_items_project_id"))

    op.drop_table("readiness_items")
    with op.batch_alter_table("milestones", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_milestones_project_id"))

    op.drop_table("milestones")
    op.drop_table("hour_overrides")
    with op.batch_alter_table("checklists", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_checklists_project_id"))

    op.drop_table("checklists")
    with op.batch_alter_table("checkins", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_checkins_project_id"))
        batch_op.drop_index(batch_op.f("ix_checkins_batch_id"))

    op.drop_table("checkins")
    with op.batch_alter_table("charter_items", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_charter_items_project_id"))

    op.drop_table("charter_items")
    op.drop_table("textbook_sections")
    op.drop_table("rotations")
    with op.batch_alter_table("remi_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_remi_events_type"))

    op.drop_table("remi_events")
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_index("ix_projects_domain_sort_order")

    op.drop_table("projects")
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.drop_index("ix_notes_day_seq")

    op.drop_table("notes")
    op.drop_table("leave_days")
    op.drop_table("holidays")
    op.drop_table("holiday_years")
    op.drop_table("chart_assets")
    with op.batch_alter_table("ai_audit", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_audit_parse_id"))
        batch_op.drop_index("ix_ai_audit_created_at")

    op.drop_table("ai_audit")
