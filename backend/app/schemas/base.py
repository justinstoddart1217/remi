"""Wire conventions shared by every DTO.

- JSON keys are camelCase; Python attributes stay snake_case (``alias_generator=to_camel``).
  Services may build models with either spelling (``populate_by_name``) or straight from ORM
  rows (``from_attributes``). Serialisation always uses the camelCase aliases.
- Business dates are ISO ``YYYY-MM-DD`` strings (``datetime.date``). Timestamps are
  timezone-aware ISO-8601 datetimes (``AwareDatetime``).
- Response models (``*Out``) declare every key: optional values are ``null``, never absent.
  ``json_schema_serialization_defaults_required`` makes that explicit in the OpenAPI output,
  so the generated TypeScript types have no optional keys on responses.
- The docstring under a field is its description in the OpenAPI document and the TS types.
- Request bodies (``*In``, ``*Create``, ``*Patch``, ``*Put``) reject unknown keys. In a PATCH,
  an absent key means "leave unchanged" and an explicit ``null`` means "clear"; services read
  ``model_fields_set`` to tell them apart.
- Request bodies are strict: a boolean must be ``true``/``false`` (not ``"yes"`` or ``1``), an
  integer a JSON integer (not ``true``, ``"3"`` or ``3.0``), a number a JSON number (not
  ``true`` or ``"1.5"``). FastAPI validates the parsed JSON in Python mode, where a strict date
  would only take a ``date`` object, so the strings JSON carries stay parseable through
  ``DateIn`` (exactly ``YYYY-MM-DD``) and ``UuidIn``. Integer literals (``phase``,
  ``stage``) refuse booleans through ``NotBool``, since ``True == 1`` in Python.
- Models that appear in both requests and responses (check-in changes, textbook blocks) have
  no defaults, so OpenAPI emits one schema for both directions.
"""

import datetime as dt
import re
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, Strict
from pydantic.alias_generators import to_camel
from pydantic.fields import ComputedFieldInfo, FieldInfo
from pydantic_core import PydanticCustomError


def _camel_title(name: str, _info: FieldInfo | ComputedFieldInfo) -> str:
    return to_camel(name.rstrip("_"))


class CamelModel(BaseModel):
    """Base for every DTO: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        serialize_by_alias=True,
        json_schema_serialization_defaults_required=True,
        # Attribute docstrings become field descriptions in OpenAPI and the TS types.
        use_attribute_docstrings=True,
        field_title_generator=_camel_title,
    )


class CamelIn(CamelModel):
    """Base for request bodies: unknown keys are a 422, not silently dropped, and values are
    strict (``{"completed": "yes"}`` and ``{"bd": true}`` are 422s; see the module docstring)."""

    model_config = ConfigDict(extra="forbid", strict=True)


_ISO_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}")


def _date_input(value: object) -> object:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, str) and _ISO_DATE.fullmatch(value):
        return value
    raise PydanticCustomError("date_type", "Input should be a date in the format YYYY-MM-DD")


def _not_bool(value: object) -> object:
    if isinstance(value, bool):
        raise PydanticCustomError("int_type", "Input should be a valid integer")
    return value


DateIn = Annotated[dt.date, Strict(False), BeforeValidator(_date_input)]
"""A date in a request body: an ISO ``YYYY-MM-DD`` string (or a ``date`` from Python)."""

UuidIn = Annotated[UUID, Strict(False)]
"""A UUID in a request body, sent as its string."""

NotBool: Final = BeforeValidator(_not_bool)
"""For integer ``Literal`` types, which would otherwise take ``true`` as 1."""


# ---------------------------------------------------------------- shared vocabulary
Domain = Literal["pc", "fi"]
"""``pc`` = Private Credit (before the move), ``fi`` = Fixed Income (after it)."""

EntityId = Annotated[str, Field(min_length=1, max_length=64)]
"""Server ids are UUID strings. Fixtures use deterministic uuid5 values; treat them as opaque."""

HoursPerDay = Annotated[float, Field(ge=0, le=24)]
"""Hours in one business day (rates, overrides, task hours, routine hours)."""

IsoMonth = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-10"])]
"""A calendar month, ``YYYY-MM``."""

CssColour = Annotated[
    str,
    Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9#(),.%\s\-]+$"),
]
"""A CSS colour value such as ``#009D80``, ``var(--fi-accent)`` or ``oklch(0.5 0.1 200)``."""

HexColour = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$", examples=["#009D80"])]


class OrderPut(CamelIn):
    """A full reordering: every id of the collection, in the new order."""

    ids: list[EntityId] = Field(max_length=500)
