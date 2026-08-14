from __future__ import annotations

from datetime import datetime
import hashlib
import json
from typing import Any

from smart_insights.contracts import RawSnapshot, SourceDefinition
from smart_insights.event_contracts import EventCollectionBatch, EventObservation
from smart_insights.http import SourceFetchError
from smart_insights.sources import is_source_url_allowed


TIMEOUT_SECONDS = 20.0
MAX_RESPONSE_BYTES = 8_000_000


def fetch_event_json(
    *, source: SourceDefinition, transport: Any, request_url: str, observed_at: datetime
) -> tuple[RawSnapshot, object] | EventCollectionBatch:
    if not is_source_url_allowed(source, request_url):
        raise ValueError("Event source request URL is not allow-listed.")
    response = transport.fetch(
        request_url,
        timeout_seconds=TIMEOUT_SECONDS,
        max_bytes=MAX_RESPONSE_BYTES,
    )
    if response.status != 200 or response.url != request_url:
        raise SourceFetchError("INVALID_RESPONSE")
    snapshot = RawSnapshot(
        content=response.body,
        content_type="application/json",
        source_url=request_url,
        effective_at=None,
        published_at=None,
        observed_at=observed_at,
        metadata={
            "content_sha256": hashlib.sha256(response.body).hexdigest(),
            "parser_version": source.parser_version,
        },
    )
    try:
        payload = json.loads(response.body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return EventCollectionBatch(source, snapshot, (), "INVALID_RESPONSE")
    return snapshot, payload


def schema_drift(source: SourceDefinition, snapshot: RawSnapshot) -> EventCollectionBatch:
    return EventCollectionBatch(source, snapshot, (), "SCHEMA_DRIFT")


def completed(
    source: SourceDefinition,
    snapshot: RawSnapshot,
    events: list[EventObservation],
) -> EventCollectionBatch:
    if len(events) > source.max_rows:
        return EventCollectionBatch(source, snapshot, (), "RESPONSE_TOO_LARGE")
    return EventCollectionBatch(source, snapshot, tuple(events))


def parse_iso_utc(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("timestamp")
    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp")
    return parsed


def required_str(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("string")
    return value.strip()


def optional_str(value: object) -> str | None:
    if value is None:
        return None
    return required_str(value)


def optional_number(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("number")
    return float(value)


def optional_nonnegative_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("count")
    return value
