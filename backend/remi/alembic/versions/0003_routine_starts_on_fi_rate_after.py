"""When a routine starts, and Fixed Income after-move rates that were left at 0.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25

- ``routines.starts_on``: the first day a routine runs (``NULL`` = it always has). Runs before
  it are not due, overdue or loaded, so a routine added mid-month does not show the month's
  earlier runs as overdue. Existing routines take the business date of their
  ``routine.created`` event (the day they were added); routines without one (the design
  fixture, imports) stay ``NULL``.
- ``projects.rate_after_move``: a Fixed Income project created in the UI kept 0h after the
  move whatever its rate, so its work stalled at the move. Fixed Income work carries on after
  the move, so a Fixed Income project with a rate and a zero after-move rate takes its rate
  there. A forecast that had already stalled at the move is placed again the next time the
  project (or anything that reshapes its hours) is edited.

Migrations must not import ``app``: they describe the schema as it was at this revision.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.add_column(sa.Column("starts_on", sa.Date(), nullable=True))
    op.execute(
        "UPDATE routines SET starts_on = ("
        " SELECT e.business_date FROM remi_events AS e"
        " WHERE e.type = 'routine.created' AND EXISTS ("
        "  SELECT 1 FROM json_each(e.refs) AS r"
        "  WHERE json_extract(r.value, '$.type') = 'routine'"
        "  AND json_extract(r.value, '$.id') = routines.id)"
        " ORDER BY e.seq LIMIT 1)"
    )
    op.execute(
        "UPDATE projects SET rate_after_move = rate_hours_per_day"
        " WHERE domain = 'fi' AND rate_after_move = 0 AND rate_hours_per_day > 0"
    )


def downgrade() -> None:
    # The Fixed Income after-move rates stay as repaired (0003 cannot tell them apart).
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.drop_column("starts_on")
