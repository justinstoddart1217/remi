"""``PROPOSAL_SCHEMA``: the JSON schema a provider's reply must match.

It is generated from the Pydantic ``Change`` union in ``remi.schemas.checkin`` (snake_case
field names, as the prompt and ``validate()`` use them) and made strict-mode friendly:

- every ``$ref`` is inlined and ``$defs`` removed;
- ``oneOf`` becomes ``anyOf`` and the ``discriminator`` keyword is dropped (each branch
  still pins ``type`` with ``const``);
- every object has ``additionalProperties: false`` and lists all its properties as required;
- keywords strict tool use does not support (``minimum``/``maximum``, ``minLength``/
  ``maxLength``, ``maxItems`` ...) and ``title``/``default`` are removed. The limits still
  hold: ``validate()`` clamps, cuts and drops on the server.

Each change branch carries the prototype prompt's one-line meaning as its description.
"""

import copy
from collections.abc import Mapping
from typing import Any, Final, cast

from pydantic import TypeAdapter

from remi.schemas.checkin import Change

_DROP_KEYS: Final = frozenset(
    {
        "title",
        "default",
        "examples",
        "discriminator",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
    }
)

CHANGE_MEANINGS: Final[Mapping[str, str]] = {
    "task_done": "an existing open task is finished",
    "task_add": "a concrete next task that is part of the existing plan",
    "scope_add": "new work added to the project's scope (estimate hours if needed)",
    "blocker": "waiting on someone or something",
    "confidence": "1 to 5, only if stated or clearly implied",
    "target_move": "the target date changes (YYYY-MM-DD)",
    "hours_per_day": "planned focus hours a day change",
    "note": "progress worth logging, 20 words max",
    "bau_done": "a BAU routine that runs today is finished",
}


def _resolve(node: Any, defs: Mapping[str, Any]) -> Any:
    if isinstance(node, list):
        return [_resolve(x, defs) for x in cast("list[Any]", node)]
    if not isinstance(node, dict):
        return node
    obj = cast("dict[str, Any]", node)
    ref = obj.get("$ref")
    if isinstance(ref, str):
        target = defs[ref.rsplit("/", 1)[-1]]
        merged = {**cast("dict[str, Any]", target), **{k: v for k, v in obj.items() if k != "$ref"}}
        return _resolve(merged, defs)
    out: dict[str, Any] = {}
    for key, value in obj.items():
        if key in _DROP_KEYS or key == "$defs":
            continue
        out["anyOf" if key == "oneOf" else key] = _resolve(value, defs)
    if out.get("type") == "object" and isinstance(out.get("properties"), dict):
        out["additionalProperties"] = False
        out["required"] = list(cast("dict[str, Any]", out["properties"]))
    return out


def strict_schema(schema: Mapping[str, Any]) -> dict[str, Any]:
    """``schema`` with refs inlined and unsupported keywords removed (see the docstring)."""
    defs = cast("Mapping[str, Any]", schema.get("$defs", {}))
    return cast("dict[str, Any]", _resolve(copy.deepcopy(dict(schema)), defs))


def _change_schema() -> dict[str, Any]:
    raw = TypeAdapter(Change).json_schema(by_alias=False)
    union = strict_schema(raw)
    for branch in cast("list[dict[str, Any]]", union["anyOf"]):
        kind = cast("str", branch["properties"]["type"]["const"])
        branch["description"] = CHANGE_MEANINGS[kind]
    return union


def build_proposal_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": (
                    "one or two plain sentences, second person, saying what you will change"
                ),
            },
            "changes": {"type": "array", "items": _change_schema()},
            "unplaced": {
                "type": "array",
                "items": {"type": "string"},
                "description": "short quote of anything you could not map",
            },
        },
        "required": ["summary", "changes", "unplaced"],
        "additionalProperties": False,
    }


PROPOSAL_SCHEMA: Final = build_proposal_schema()
"""The reply schema for both providers (Anthropic tool input, Ollama ``format``)."""
