"""Pure planning engine: the single source of every number Remi shows (ADR-0007).

No I/O is allowed in this package: no database, clock, network, FastAPI or ``holidays``
imports. Services adapt ORM rows into the frozen dataclasses in ``model`` and call:

- ``calendar``: ``BusinessCalendar`` (raises ``OutOfCalendar`` instead of clamping);
- ``routines``: ``occurs``, ``counts_on``, ``next_occurrences``, ``last_occurrence_before``;
- ``rotation``: ``layout``, ``current``;
- ``forecast``: ``day_hours``, ``finish_for``, ``work_left``, ``rescale``, ``refit``,
  ``slip_for_scope``, ``solve_need_rate`` and the absorb/cut figures;
- ``loads``: ``day_load``, ``build_loads``, ``plan_window``;
- ``derive``: ``derive_project`` (status, metrics, sentence case, milestones);
- ``verdict``: ``verdict``, ``countdown``, ``key_run``, ``move_strip``;
- ``flags``: ``upcoming_overloads``, ``attention``, ``checkin_prompt``;
- ``allocation``: ``focus_tasks``, ``month_snapshot``, ``next_run_after``;
- ``checkin``: ``preview`` / ``apply_changes`` (one code path), ``diff_movements``,
  ``summarise_checkin``;
- ``aliases``: ``build_index``, ``tags_for``; ``simple_reading``: ``parse_simple``;
- ``validate``: ``validate``, ``validation_state``.
"""
