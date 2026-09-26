"""Unit of work: one mutation = one transaction = exactly one ``remi_events`` row.

Usage (inside a service command)::

    with uow_factory(actor="user") as uow:
        project = uow.repo(PROJECTS).get(project_id)       # typed repository
        project.name = "Returns pipeline"
        uow.record("project.renamed", [ref("project", project.id)], {"name": project.name})

* ``__enter__`` opens a session whose transaction starts with ``BEGIN IMMEDIATE``.
* A ``before_flush`` listener stamps ``created_at``/``updated_at`` from the clock and assigns
  missing UUIDs. An ``after_flush`` listener then captures ``{table, id, op, before, after}``
  for every row the ORM flush inserted, updated or deleted. It runs once foreign keys have
  been synchronised from relationships (``Task(project=p)``, ``task.milestone = m2``) and
  sees delete-orphan cascades (``p.tasks.remove(t)``). Bulk DML is noted as ``bulk_*``
  without row detail. Rows removed or nulled by the database itself (``ON DELETE CASCADE`` /
  ``SET NULL`` on children the session never loaded) are not itemised.
* ``__exit__`` commits: it flushes, refuses to commit state changes without an event
  (:class:`MissingEventError`), writes one :class:`RemiEvent` with
  ``payload = {"input", "effects", "diff"?}`` and commits. On an exception it rolls back and
  writes nothing. Either way it then closes the session and releases the writer slot, and
  only then runs the ``after_commit`` / ``after_rollback`` hooks, so a hook may open a new
  unit of work of its own.
* Modes: ``"write"`` (default), ``"dry_run"`` (flushes allowed, always rolled back, no event;
  used by check-in preview) and ``"read"`` (deferred ``BEGIN``, any write raises
  :class:`ReadOnlyViolation`).
* Repositories attach lazily: :func:`register_repository` returns a typed :class:`RepoKey`;
  ``uow.repo(KEY)`` (typed) or ``uow.<name>`` (untyped) builds one per unit of work.
"""

import json
import logging
import re
from collections.abc import Callable, Iterable, Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Final, Literal, Self, TypedDict, cast, overload

from sqlalchemy import Connection, event
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import InstanceState, ORMExecuteState, Session, UOWTransaction

from remi.core import ids
from remi.core.clock import Clock
from remi.core.db import begin_write, to_jsonable
from remi.repositories.models.base import CreatedAt, Timestamps, UUIDPk
from remi.repositories.models.events import EVENT_SCHEMA_VERSION, Actor, RemiEvent

logger = logging.getLogger(__name__)

UNAUDITED_TABLES: Final = frozenset({"remi_events", "ai_audit"})
"""Writes to these tables are logs, not plan state: no event is required and no diff kept."""

Mode = Literal["write", "dry_run", "read"]
DiffOp = Literal["insert", "update", "delete", "bulk_insert", "bulk_update", "bulk_delete"]
Hook = Callable[[], object]


class Ref(TypedDict):
    """A reference from an event to an entity, e.g. ``{"type": "project", "id": "…"}``."""

    type: str
    id: str


RefLike = Ref | tuple[str, str]


def ref(entity_type: str, entity_id: str) -> Ref:
    return {"type": entity_type, "id": entity_id}


class DiffEntry(TypedDict):
    table: str
    id: Any
    op: DiffOp
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class MissingEventError(RuntimeError):
    """A unit of work changed state but never called :meth:`UnitOfWork.record`."""


class ReadOnlyViolation(RuntimeError):
    """A read-only unit of work tried to write."""


class UnitOfWorkError(RuntimeError):
    """The unit of work was used incorrectly (not entered, entered twice, nested ...)."""


# ------------------------------------------------------------------ repository registry


class RepoKey[R]:
    """A typed handle on a registered repository factory."""

    __slots__ = ("factory", "name")

    def __init__(self, name: str, factory: Callable[[Session], R]) -> None:
        self.name = name
        self.factory = factory

    def __repr__(self) -> str:
        return f"RepoKey({self.name!r})"


_REGISTRY: dict[str, RepoKey[Any]] = {}


def register_repository[R](
    name: str, factory: Callable[[Session], R], *, replace: bool = False
) -> RepoKey[R]:
    """Register ``factory(session)`` under ``name`` and return its typed key.

    Registering the same factory twice is a no-op; a different factory for a taken name needs
    ``replace=True``.
    """
    if not name.isidentifier() or name.startswith("_"):
        msg = f"repository name {name!r} must be a public Python identifier"
        raise ValueError(msg)
    if hasattr(UnitOfWork, name):
        msg = f"repository name {name!r} clashes with a UnitOfWork attribute"
        raise ValueError(msg)
    existing = _REGISTRY.get(name)
    if existing is not None and existing.factory is not factory and not replace:
        msg = f"repository {name!r} is already registered"
        raise ValueError(msg)
    key = RepoKey(name, factory)
    _REGISTRY[name] = key
    return key


def unregister_repository(name: str) -> None:
    _REGISTRY.pop(name, None)


def registered_repositories() -> Mapping[str, RepoKey[Any]]:
    return dict(_REGISTRY)


# ------------------------------------------------------------------ statement classification

_DML_TABLE = re.compile(
    r"""^\s*(?:INSERT|REPLACE|UPDATE|DELETE)\s+(?:OR\s+\w+\s+)?(?:INTO\s+|FROM\s+)?
        ["`\[]?(?P<table>\w+)""",
    re.IGNORECASE | re.VERBOSE,
)
_WRITE_WORDS: Final = frozenset({"INSERT", "REPLACE", "UPDATE", "DELETE"})
_DDL_WORDS: Final = frozenset({"CREATE", "DROP", "ALTER"})


def written_table(statement: str) -> str | None:
    """The table a write statement targets, ``"?"`` if unknown, ``None`` for non-writes."""
    head = statement.lstrip().split(None, 1)
    if not head:
        return None
    word = head[0].upper()
    if word in _WRITE_WORDS:
        match = _DML_TABLE.match(statement)
        return match.group("table").lower() if match else "?"
    if word in _DDL_WORDS:
        return "?"
    if word == "WITH" and re.search(r"\b(INSERT|REPLACE|UPDATE|DELETE)\b", statement, re.I):
        return "?"
    return None


# ------------------------------------------------------------------ diff capture


def _jsonable(value: Any) -> Any:
    try:
        return to_jsonable(value)
    except TypeError:
        return repr(value)


def _state(obj: object) -> InstanceState[Any]:
    return cast(InstanceState[Any], sa_inspect(obj))


def _table_name(state: InstanceState[Any]) -> str:
    table = state.mapper.local_table
    return str(getattr(table, "name", table))


def _identity(state: InstanceState[Any]) -> Any:
    """The row's primary key as loaded (after a flush: including generated/synced values)."""
    mapper = state.mapper
    columns = mapper.primary_key
    persisted: tuple[Any, ...] = tuple(state.key[1]) if state.key is not None else ()
    values: list[Any] = []
    for index, column in enumerate(columns):
        key = mapper.get_property_by_column(column).key
        if key in state.dict:
            values.append(state.dict[key])
        elif index < len(persisted):
            values.append(persisted[index])
        else:
            values.append(None)
    if len(columns) == 1:
        return _jsonable(values[0])
    return {str(col.name): _jsonable(v) for col, v in zip(columns, values, strict=True)}


def _insert_values(state: InstanceState[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for prop in state.mapper.column_attrs:
        column = prop.columns[0]
        if prop.key in state.dict:
            value = state.dict[prop.key]
        else:
            default = getattr(column, "default", None)
            if default is None or not getattr(default, "is_scalar", False):
                continue
            value = default.arg
        out[str(column.name)] = _jsonable(value)
    return out


def _update_values(state: InstanceState[Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for prop in state.mapper.column_attrs:
        history = state.attrs[prop.key].history
        if not history.has_changes():
            continue
        name = str(prop.columns[0].name)
        before[name] = _jsonable(history.deleted[0]) if history.deleted else None
        after[name] = _jsonable(history.added[0]) if history.added else None
    return before, after


def _delete_values(state: InstanceState[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for prop in state.mapper.column_attrs:
        history = state.attrs[prop.key].history
        if history.deleted:
            value = history.deleted[0]
        elif prop.key in state.dict:
            value = state.dict[prop.key]
        else:
            continue
        out[str(prop.columns[0].name)] = _jsonable(value)
    return out


def _merge(existing: DiffEntry, new: DiffEntry) -> DiffEntry | None:
    """Fold a later change to the same row into its earlier entry (``None`` = no net change)."""
    old_op, new_op = existing["op"], new["op"]
    if old_op == "insert":
        if new_op == "delete":
            return None
        after = dict(existing["after"] or {})
        after.update(new["after"] or {})
        return {**existing, "after": after}
    if old_op == "update":
        if new_op == "delete":
            before = dict(new["before"] or {})
            before.update(existing["before"] or {})
            return {**existing, "op": "delete", "before": before, "after": None}
        before = dict(new["before"] or {})
        before.update(existing["before"] or {})
        after = dict(existing["after"] or {})
        after.update(new["after"] or {})
        return {**existing, "before": before, "after": after}
    if old_op == "delete" and new_op == "insert":
        return {**existing, "op": "update", "after": new["after"]}
    return new


@dataclass(slots=True)
class _Recorded:
    type: str
    refs: list[Ref]
    data: dict[str, Any]
    capture_diff: bool


_active_writer: ContextVar["UnitOfWork | None"] = ContextVar("remi_active_uow", default=None)

_Phase = Literal["new", "active", "committed", "rolled_back"]


class UnitOfWork:
    """One service command's transaction. See the module docstring."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        clock: Clock,
        actor: Actor = "user",
        *,
        mode: Mode = "write",
    ) -> None:
        self._session_factory = session_factory
        self.clock = clock
        self.actor: Actor = actor
        self.mode: Mode = mode
        self._phase: _Phase = "new"
        self._session: Session | None = None
        self._connection: Connection | None = None
        self._token: Token[UnitOfWork | None] | None = None
        self._repos: dict[str, object] = {}
        self._record: _Recorded | None = None
        self._effects: dict[str, Any] = {}
        self._event_id: str | None = None
        self._diff: dict[tuple[str, str], DiffEntry] = {}
        self._bulk_count = 0
        self._touched: set[str] = set()
        self._after_commit: list[Hook] = []
        self._after_rollback: list[Hook] = []
        self._finishing = False
        self.committed_seq: int | None = None
        """``remi_events.seq`` of the event written by this unit of work, after commit."""

    # -------------------------------------------------------------- lifecycle

    def __enter__(self) -> Self:
        if self._phase != "new":
            msg = "a UnitOfWork can only be entered once"
            raise UnitOfWorkError(msg)
        if self.mode != "read":
            if _active_writer.get() is not None:
                msg = "nested writing UnitOfWork: services must not open a second one"
                raise UnitOfWorkError(msg)
            self._token = _active_writer.set(self)
        session = self._session_factory()
        try:
            connection = session.connection() if self.mode == "read" else begin_write(session)
            event.listen(session, "before_flush", self._before_flush)
            event.listen(session, "after_flush", self._after_flush)
            event.listen(session, "do_orm_execute", self._on_orm_execute)
            event.listen(session, "before_commit", self._on_before_commit)
            event.listen(session, "after_begin", self._on_after_begin)
            event.listen(connection, "before_cursor_execute", self._on_cursor_execute)
        except BaseException:
            session.close()
            self._release_writer()
            raise
        self._session = session
        self._connection = connection
        self._phase = "active"
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._phase != "active":
            return
        try:
            if exc_type is not None or self.mode != "write":
                self._rollback()
            else:
                self._commit()
        finally:
            try:
                self._close()
            finally:
                # Only now: the session is closed and the writer slot released, so a hook
                # may open (and commit) a unit of work of its own.
                self._run_final_hooks()

    @property
    def session(self) -> Session:
        if self._session is None or self._phase != "active":
            msg = "the UnitOfWork is not active (use it as a context manager)"
            raise UnitOfWorkError(msg)
        return self._session

    @property
    def active(self) -> bool:
        return self._phase == "active"

    @property
    def event_id(self) -> str:
        """The id the event will have (use it e.g. as the check-in ``batch_id``)."""
        if self._event_id is None:
            self._event_id = ids.new_id()
        return self._event_id

    # -------------------------------------------------------------- recording

    def record(
        self,
        event_type: str,
        refs: Iterable[RefLike] = (),
        data: Mapping[str, Any] | None = None,
        *,
        capture_diff: bool = True,
        effects: Mapping[str, Any] | None = None,
    ) -> str:
        """Declare this command's event (exactly once). Returns the event id.

        ``data`` is the command input (stored as ``payload.input``); ``effects`` is merged
        into ``payload.effects``. With ``capture_diff=False`` the row diff is not stored
        (e.g. Textbook autosave, which records only ``{pageId, version, blockCount}``).
        """
        self._require_active()
        if self.mode == "read":
            msg = "a read-only UnitOfWork cannot record events"
            raise UnitOfWorkError(msg)
        if self._record is not None:
            msg = f"record() was already called for {self._record.type!r}"
            raise UnitOfWorkError(msg)
        if not event_type:
            msg = "event type must not be empty"
            raise ValueError(msg)
        normalised: list[Ref] = []
        for item in refs:
            if isinstance(item, tuple):
                normalised.append(ref(item[0], item[1]))
            else:
                normalised.append(ref(item["type"], item["id"]))
        self._record = _Recorded(
            type=event_type,
            refs=normalised,
            data=cast(dict[str, Any], _jsonable(dict(data or {}))),
            capture_diff=capture_diff,
        )
        if effects:
            self.add_effects(effects)
        return self.event_id

    def add_effects(self, effects: Mapping[str, Any]) -> None:
        """Merge computed outcomes (e.g. forecast movements) into ``payload.effects``."""
        self._require_active()
        self._effects.update(cast(dict[str, Any], _jsonable(dict(effects))))

    @property
    def recorded_type(self) -> str | None:
        return self._record.type if self._record is not None else None

    @property
    def diff(self) -> list[DiffEntry]:
        """The row changes captured so far (flushed changes only)."""
        return list(self._diff.values())

    def after_commit(self, fn: Hook) -> Hook:
        """Run ``fn`` after a successful commit (errors are logged, not raised).

        Hooks run once the session is closed and the writer slot is released, so a hook
        may open a new unit of work (e.g. to garbage-collect unreferenced chart assets).
        """
        self._after_commit.append(fn)
        return fn

    def after_rollback(self, fn: Hook) -> Hook:
        """Run ``fn`` after a rollback, e.g. to delete a file this command wrote.

        Like :meth:`after_commit`, it runs after the session is closed.
        """
        self._after_rollback.append(fn)
        return fn

    # -------------------------------------------------------------- repositories

    @overload
    def repo[R](self, key: RepoKey[R]) -> R: ...
    @overload
    def repo(self, key: str) -> Any: ...
    def repo(self, key: RepoKey[Any] | str) -> Any:
        """The repository for ``key``, built on first use and cached for this unit of work."""
        if isinstance(key, str):
            found = _REGISTRY.get(key)
            if found is None:
                msg = f"no repository registered as {key!r}"
                raise KeyError(msg)
            key = found
        cached = self._repos.get(key.name)
        if cached is None:
            cached = key.factory(self.session)
            self._repos[key.name] = cached
        return cached

    def __getattr__(self, name: str) -> Any:
        # Only reached for attributes that do not exist: registered repositories by name.
        if not name.startswith("_") and name in _REGISTRY:
            return self.repo(name)
        msg = f"{type(self).__name__!r} object has no attribute {name!r}"
        raise AttributeError(msg)

    # -------------------------------------------------------------- internals

    def _require_active(self) -> None:
        if self._phase != "active":
            msg = "the UnitOfWork is not active (use it as a context manager)"
            raise UnitOfWorkError(msg)

    def _commit(self) -> None:
        session = self.session
        try:
            session.flush()
            if self._touched and self._record is None:
                tables = ", ".join(sorted(self._touched))
                msg = f"state changed ({tables}) but no event was recorded: call uow.record()"
                raise MissingEventError(msg)
            if self._record is not None:
                event_row = self._event_row(self._record)
                session.add(event_row)
                session.flush()
                self.committed_seq = event_row.seq
            self._finishing = True
            session.commit()
        except BaseException:
            self.committed_seq = None
            self._rollback()
            raise
        self._phase = "committed"

    def _event_row(self, recorded: _Recorded) -> RemiEvent:
        payload: dict[str, Any] = {"input": recorded.data, "effects": dict(self._effects)}
        if recorded.capture_diff:
            payload["diff"] = list(self._diff.values())
        return RemiEvent(
            id=self.event_id,
            at=self.clock.now(),
            business_date=self.clock.today(),
            type=recorded.type,
            actor=self.actor,
            refs=list(recorded.refs),
            payload=payload,
            schema_version=EVENT_SCHEMA_VERSION,
        )

    def _rollback(self) -> None:
        if self._session is not None:
            try:
                self._finishing = True
                self._session.rollback()
            except Exception:
                logger.exception("rollback failed")
        self._phase = "rolled_back"

    def _close(self) -> None:
        try:
            if self._session is not None:
                self._session.close()
        finally:
            self._release_writer()

    def _release_writer(self) -> None:
        if self._token is not None:
            _active_writer.reset(self._token)
            self._token = None

    def _run_final_hooks(self) -> None:
        if self._phase == "committed":
            hooks, label = self._after_commit, "after_commit"
        elif self._phase == "rolled_back":
            hooks, label = self._after_rollback, "after_rollback"
        else:  # pragma: no cover - __exit__ always ends in one of the two
            return
        pending = list(hooks)
        self._after_commit.clear()
        self._after_rollback.clear()
        for hook in pending:
            try:
                hook()
            except Exception:
                logger.exception("%s hook %r failed", label, hook)

    def _add_diff(self, entry: DiffEntry) -> None:
        if entry["op"].startswith("bulk_"):
            self._bulk_count += 1
            self._diff[("#bulk", str(self._bulk_count))] = entry
            return
        key = (entry["table"], json.dumps(entry["id"], sort_keys=True, default=str))
        existing = self._diff.get(key)
        if existing is None:
            self._diff[key] = entry
            return
        merged = _merge(existing, entry)
        if merged is None:
            del self._diff[key]
        else:
            self._diff[key] = merged

    # SQLAlchemy event handlers

    def _before_flush(
        self, session: Session, _flush_context: UOWTransaction, _instances: object
    ) -> None:
        now = self.clock.now()
        new = list(session.new)
        dirty = [o for o in session.dirty if session.is_modified(o, include_collections=False)]

        if self.mode == "read":
            if new or dirty or session.deleted:
                msg = "a read-only UnitOfWork cannot flush changes"
                raise ReadOnlyViolation(msg)
            return

        for obj in new:
            if isinstance(obj, UUIDPk) and obj.id is None:  # pyright: ignore[reportUnnecessaryComparison]
                obj.id = ids.new_id()
            if isinstance(obj, Timestamps):
                if obj.created_at is None:  # pyright: ignore[reportUnnecessaryComparison]
                    obj.created_at = now
                if obj.updated_at is None:  # pyright: ignore[reportUnnecessaryComparison]
                    obj.updated_at = now
            elif isinstance(obj, CreatedAt) and obj.created_at is None:  # pyright: ignore[reportUnnecessaryComparison]
                obj.created_at = now
        for obj in dirty:
            if isinstance(obj, Timestamps):
                history = _state(obj).attrs["updated_at"].history
                if not history.added:
                    # When it already holds ``now`` (a frozen clock, a second write in the same
                    # instant) this records no change and the column is left out of the UPDATE,
                    # which keeps ``now``: the column has no ``onupdate`` to stamp wall time.
                    obj.updated_at = now

    def _after_flush(self, session: Session, flush_context: UOWTransaction) -> None:
        """Capture the row diff of the flush that just ran.

        At this point the SQL has been emitted, so foreign keys synced from relationships and
        generated keys are in each instance's dict, while ``session.new``/``dirty``/``deleted``
        and attribute history still describe the state before the flush. Delete-orphan
        cascades are only visible in ``flush_context`` (``is_deleted``), not in
        ``session.deleted``.
        """
        if self.mode != "write":
            return
        uow_tx: Any = flush_context  # UOWTransaction's attributes are untyped
        flushed = cast(Mapping[InstanceState[Any], tuple[bool, bool]], uow_tx.states)
        if not flushed:
            return
        inserted = {_state(obj) for obj in session.new}
        for state in self._flush_order(session, flushed):
            table = _table_name(state)
            if table in UNAUDITED_TABLES:
                continue
            if uow_tx.is_deleted(state):
                if state.key is None:  # pending then orphaned: never reached the database
                    continue
                self._add_diff(
                    {
                        "table": table,
                        "id": _identity(state),
                        "op": "delete",
                        "before": _delete_values(state),
                        "after": None,
                    }
                )
            elif state in inserted:
                self._add_diff(
                    {
                        "table": table,
                        "id": _identity(state),
                        "op": "insert",
                        "before": None,
                        "after": _insert_values(state),
                    }
                )
            else:
                before, after = _update_values(state)
                if before or after:
                    self._add_diff(
                        {
                            "table": table,
                            "id": _identity(state),
                            "op": "update",
                            "before": before,
                            "after": after,
                        }
                    )

    @staticmethod
    def _flush_order(
        session: Session, flushed: Mapping[InstanceState[Any], object]
    ) -> list[InstanceState[Any]]:
        """The flushed states in a stable order: added, then modified, then deleted.

        ``flush_context.states`` is filled from sets, so its order varies between runs; the
        session's ``new`` and ``deleted`` keep the order objects were added / deleted in.
        States with no stable order (modified rows, cascaded orphans) sort by table and key.
        """
        added = [s for s in map(_state, session.new) if s in flushed]
        deleted = [s for s in map(_state, session.deleted) if s in flushed]
        known = {*added, *deleted}
        rest = [s for s in flushed if s not in known]
        rest.sort(key=lambda s: (_table_name(s), json.dumps(_identity(s), default=str)))
        return [*added, *rest, *deleted]

    def _on_before_commit(self, session: Session) -> None:
        # Releasing a savepoint (begin_nested) also fires before_commit; that is fine.
        if not self._finishing and not session.in_nested_transaction():
            msg = "do not call session.commit() inside a UnitOfWork; it commits on exit"
            raise UnitOfWorkError(msg)

    def _on_after_begin(
        self, _session: Session, _transaction: object, connection: Connection
    ) -> None:
        # Savepoints reuse the unit's connection; a different one means the unit's own
        # transaction was ended early (e.g. session.rollback() after a failed flush).
        if connection is self._connection or self._finishing:
            return
        if self.mode == "read":
            event.listen(connection, "before_cursor_execute", self._on_cursor_execute)
            self._connection = connection
            return
        msg = (
            "the UnitOfWork's transaction was ended early (session.commit() or rollback()); "
            "let the UnitOfWork commit or roll back"
        )
        raise UnitOfWorkError(msg)

    def _on_orm_execute(self, orm_execute_state: ORMExecuteState) -> None:
        op: DiffOp
        if orm_execute_state.is_insert:
            op = "bulk_insert"
        elif orm_execute_state.is_update:
            op = "bulk_update"
        elif orm_execute_state.is_delete:
            op = "bulk_delete"
        else:
            return
        if self.mode == "read":
            msg = "a read-only UnitOfWork cannot execute DML"
            raise ReadOnlyViolation(msg)
        target: Any = getattr(orm_execute_state.statement, "table", None)
        table = str(getattr(target, "name", "?"))
        if self.mode == "write" and table not in UNAUDITED_TABLES:
            self._add_diff({"table": table, "id": None, "op": op, "before": None, "after": None})

    def _on_cursor_execute(
        self,
        _conn: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        table = written_table(statement)
        if table is None or table in UNAUDITED_TABLES:
            return
        if self.mode == "read":
            msg = f"a read-only UnitOfWork cannot write ({statement.split(None, 1)[0]} {table})"
            raise ReadOnlyViolation(msg)
        self._touched.add(table)


class UnitOfWorkFactory:
    """Builds units of work bound to one session factory and clock (inject this)."""

    __slots__ = ("clock", "session_factory")

    def __init__(self, session_factory: Callable[[], Session], clock: Clock) -> None:
        self.session_factory = session_factory
        self.clock = clock

    def __call__(self, actor: Actor = "user", *, mode: Mode = "write") -> UnitOfWork:
        return UnitOfWork(self.session_factory, self.clock, actor, mode=mode)

    def read(self) -> UnitOfWork:
        return UnitOfWork(self.session_factory, self.clock, "system", mode="read")

    def dry_run(self, actor: Actor = "user") -> UnitOfWork:
        return UnitOfWork(self.session_factory, self.clock, actor, mode="dry_run")
