"""Identifier generation.

Every UUID primary key comes from :func:`new_id`. Tests make ids deterministic either by
monkeypatching ``remi.core.ids.new_id`` (every caller looks it up through this module at call
time) or, more conveniently, with :func:`id_factory`::

    with id_factory(sequential_ids("t")):
        ...  # new_id() -> "t-0001", "t-0002", ...
"""

from collections.abc import Callable, Generator
from contextlib import contextmanager
from itertools import count
from uuid import uuid4

IdFactory = Callable[[], str]


def uuid4_str() -> str:
    """The production factory: a random UUID4 as a 36-character string."""
    return str(uuid4())


_factory: IdFactory = uuid4_str


def new_id() -> str:
    """A new identifier from the active factory (a UUID4 string outside tests)."""
    return _factory()


def set_id_factory(factory: IdFactory | None) -> IdFactory:
    """Install ``factory`` (``None`` restores UUID4) and return the previous one."""
    global _factory
    previous = _factory
    _factory = factory if factory is not None else uuid4_str
    return previous


@contextmanager
def id_factory(factory: IdFactory) -> Generator[None]:
    """Use ``factory`` for :func:`new_id` inside the block, then restore the previous one."""
    previous = set_id_factory(factory)
    try:
        yield
    finally:
        set_id_factory(previous)


def sequential_ids(prefix: str = "id") -> IdFactory:
    """A deterministic factory: ``"<prefix>-0001"``, ``"<prefix>-0002"``, ... (max 36 chars)."""
    counter = count(1)

    def factory() -> str:
        return f"{prefix}-{next(counter):04d}"

    return factory
