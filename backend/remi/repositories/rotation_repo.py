"""``RotationRepository``: the Fixed Income rotation and its ordered segments.

Remi has one active rotation (domain ``fi``), created by first-run setup. Segment ``loop`` is
stored for reference; the read model re-derives dates and loops with the engine.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from remi.repositories.models import Rotation, RotationPass, RotationSegment


@dataclass(frozen=True, slots=True)
class SegmentSpec:
    """One segment in a full replace. ``id`` keeps an existing segment's id when given."""

    country: str
    code: str
    length_bd: int
    pass_kind: RotationPass = "Build"  # noqa: S105 - a rotation pass, not a password
    id: str | None = None


def loops_for(kinds: Sequence[RotationPass]) -> list[int]:
    """Loop numbers: 1 for the opening passes, +1 each time the pass kind changes."""
    loops: list[int] = []
    loop = 1
    previous: RotationPass | None = None
    for kind in kinds:
        if previous is not None and kind != previous:
            loop += 1
        previous = kind
        loops.append(loop)
    return loops


class RotationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_active(self) -> Rotation | None:
        """The rotation (with segments), or ``None`` before setup."""
        stmt = (
            select(Rotation)
            .where(Rotation.domain == "fi")
            .options(selectinload(Rotation.segments))
            .order_by(Rotation.created_at, Rotation.id)
        )
        return self.session.scalars(stmt).first()

    def add(self, rotation: Rotation) -> Rotation:
        self.session.add(rotation)
        return rotation

    def replace_segments(self, rotation: Rotation, segments: Sequence[SegmentSpec]) -> None:
        """Replace the ordered segment list (ids are kept for segments that send one)."""
        existing = {s.id: s for s in rotation.segments}
        loops = loops_for([s.pass_kind for s in segments])
        new: list[RotationSegment] = []
        for order, (spec, loop) in enumerate(zip(segments, loops, strict=True)):
            row = existing.pop(spec.id, None) if spec.id is not None else None
            if row is None:
                row = (
                    RotationSegment(id=spec.id, rotation_id=rotation.id)
                    if spec.id is not None
                    else RotationSegment(rotation_id=rotation.id)
                )
            row.sort_order = order
            row.country = spec.country
            row.code = spec.code
            row.length_bd = spec.length_bd
            row.pass_kind = spec.pass_kind
            row.loop = loop
            new.append(row)
        rotation.segments = new
