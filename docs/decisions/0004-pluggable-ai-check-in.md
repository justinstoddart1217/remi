# ADR-0004: The AI check-in is pluggable, defaults to `none` and only proposes

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 4

## Context
The prototype's check-in calls `window.claude.complete`, which exists only inside Claude Design.
When it is missing, the prototype falls back to a simple offline reader.

## Decision
- Providers: `none | anthropic | ollama`. The default is `none`, a deterministic "simple reading"
  parser ported from the prototype.
- The server builds the context (goals, charters and risks are never sent; recent notes only when
  the user enables it) and holds any key (environment or macOS Keychain). Keys are write-only in
  the API and never logged or returned.
- Anthropic uses the official SDK with a strict tool-use schema; Ollama must be on a loopback
  address. Every call is recorded in `ai_audit`.
- Provider output is always a proposal. The user reviews it in the drawer and nothing applies
  until they confirm; prompt-injected text cannot apply changes.

## Consequences
- A fresh install makes no AI calls at all.
- The `anthropic` extra is optional (`uv sync --extra anthropic`).
