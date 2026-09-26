"""Check-in parse providers (none | anthropic | ollama). Output is always a proposal.

- ``registry``: ``parse`` / ``parse_simple`` (the check-in endpoints), ``AiSettings``,
  ``EngineInputs``, ``PARSE_REGISTRY`` (``cancel(parse_id)``), ``select_provider``;
- ``context``: ``CheckinContextInput`` -> ``build_context`` (never goals, charters or risks;
  notes only when enabled);
- ``prompt``: ``system_prompt(capacity_h, mode)``; ``schema``: ``PROPOSAL_SCHEMA``;
- ``base``: ``ParseProvider``, ``ParseRequest``, ``RawProposal`` and the typed errors;
- ``none_provider`` / ``anthropic_provider`` / ``ollama_provider``;
- ``keys``: ``set_api_key`` / ``clear_api_key`` / ``api_key_configured`` (Keychain or env);
- ``audit``: ``uow_audit_sink``, ``list_audit``; ``status``: ``ai_status``.
"""
