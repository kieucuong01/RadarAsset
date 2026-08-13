from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import re
from typing import AbstractSet

from .contracts import ObservationInput, SourceDefinition


_METRIC_CODE = re.compile(r"^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$")
_QUALITY_STATUSES = {"passed", "warning", "conflicting"}


class ObservationValidationError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _require_aware(value: datetime | None) -> None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ObservationValidationError("INVALID_TIMESTAMP")


def validate_observations(
    source: SourceDefinition,
    rows: Sequence[ObservationInput],
    *,
    known_metric_codes: AbstractSet[str] | None = None,
) -> tuple[ObservationInput, ...]:
    if not rows:
        raise ObservationValidationError("MISSING_REQUIRED_FIELD")
    if len(rows) > source.max_rows:
        raise ObservationValidationError("INVALID_RESPONSE")

    natural_keys: set[tuple[str, str, str, str]] = set()
    for row in rows:
        _require_aware(row.effective_at)
        _require_aware(row.effective_start)
        _require_aware(row.effective_end)
        _require_aware(row.published_at)
        if not row.value.is_finite():
            raise ObservationValidationError("INVALID_UNIT")
        if not _METRIC_CODE.fullmatch(row.metric_code):
            raise ObservationValidationError("MISSING_REQUIRED_FIELD")
        if known_metric_codes is not None and row.metric_code not in known_metric_codes:
            raise ObservationValidationError("MISSING_REQUIRED_FIELD")
        if row.quality_status not in _QUALITY_STATUSES:
            raise ObservationValidationError("INVALID_RESPONSE")
        if any(
            not isinstance(key, str)
            or not key
            or not isinstance(value, str)
            or not value
            for key, value in row.dimensions.items()
        ):
            raise ObservationValidationError("MISSING_REQUIRED_FIELD")
        natural_key = (
            row.metric_code,
            row.asset_symbol or "GLOBAL",
            row.effective_at.astimezone(timezone.utc).isoformat(),
            row.dimension_key,
        )
        if natural_key in natural_keys:
            raise ObservationValidationError("DUPLICATE_CONFLICT")
        natural_keys.add(natural_key)
    return tuple(rows)
