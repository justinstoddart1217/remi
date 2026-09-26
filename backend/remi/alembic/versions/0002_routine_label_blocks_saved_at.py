"""Routine display labels, and when a Textbook page's blocks were last saved.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-25

- ``routines.label``: the curated row label the Timeline shows (``NULL`` = use the name).
- ``textbook_pages.blocks_saved_at``: when the page's blocks were last written. The chart
  garbage collector dates a dropped chart reference by it; ``updated_at`` also moves on a
  rename, which could collect a freshly re-uploaded chart. Existing pages start from their
  ``updated_at`` (the best earlier bound there is).

Migrations must not import ``app``: they describe the schema as it was at this revision.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.add_column(sa.Column("label", sa.String(length=200), nullable=True))
    with op.batch_alter_table("textbook_pages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("blocks_saved_at", sa.String(length=32), nullable=True))
    op.execute("UPDATE textbook_pages SET blocks_saved_at = updated_at")


def downgrade() -> None:
    with op.batch_alter_table("textbook_pages", schema=None) as batch_op:
        batch_op.drop_column("blocks_saved_at")
    with op.batch_alter_table("routines", schema=None) as batch_op:
        batch_op.drop_column("label")
