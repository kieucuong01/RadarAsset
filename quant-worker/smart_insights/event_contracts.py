from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from .contracts import RawSnapshot, SourceDefinition


JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]


@dataclass(frozen=True, slots=True)
class EventInput:
    source_code: str
    source_event_key: str
    category: str
    subcategory: str | None
    title: str
    occurred_at: datetime
    provider_severity: float | None
    country: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    affected_count: int | None
    fatalities: int | None
    source_url: str | None
    dimensions: Mapping[str, JsonValue]
    quality_flags: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class EventObservation:
    source_code: str
    source_event_key: str
    category: str
    subcategory: str | None
    title: str
    occurred_at: datetime
    first_observed_at: datetime
    last_observed_at: datetime
    normalized_severity: float | None
    provider_severity: float | None
    country: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    affected_count: int | None
    fatalities: int | None
    source_url: str | None
    parser_version: str
    quality_flags: tuple[str, ...]
    dimensions: Mapping[str, JsonValue]
    content_hash: str


@dataclass(frozen=True, slots=True)
class EventCollectionBatch:
    source: SourceDefinition
    snapshot: RawSnapshot
    events: tuple[EventObservation, ...]
    error_code: str | None = None

    @property
    def source_code(self) -> str:
        return self.source.code
