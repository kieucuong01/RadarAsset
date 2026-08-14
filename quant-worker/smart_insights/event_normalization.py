from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from urllib.parse import urlsplit

from .event_contracts import EventInput, EventObservation, JsonValue


_CATEGORY_ALIASES = {
    "earthquake": "natural_hazard",
    "flood": "natural_hazard",
    "severe storm": "natural_hazard",
    "volcano": "natural_hazard",
    "wildfire": "natural_hazard",
}

_CANONICAL_CATEGORIES = {
    "energy",
    "geopolitical",
    "natural_hazard",
    "other",
    "sanctions",
    "trade",
}

_PARSER_VERSIONS = {
    "gdelt-events": "gdelt-events-v1",
    "gdacs-events": "gdacs-events-v1",
    "usgs-earthquakes": "usgs-earthquakes-v1",
    "nasa-eonet": "nasa-eonet-v1",
}

_GDACS_ALERT_SEVERITY = {
    "green": 25.0,
    "orange": 60.0,
    "red": 90.0,
}


def _canonical_title(value: str) -> str:
    return " ".join(value.split())


def _require_aware(value: datetime, field: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")


def _required_text(value: str, field: str, *, maximum: int) -> str:
    normalized = _canonical_title(value)
    if not normalized:
        raise ValueError(f"{field} is required")
    if len(normalized) > maximum:
        raise ValueError(f"{field} exceeds {maximum} characters")
    return normalized


def _optional_text(value: str | None, *, maximum: int) -> str | None:
    if value is None:
        return None
    normalized = _canonical_title(value)
    if not normalized:
        return None
    if len(normalized) > maximum:
        raise ValueError(f"text exceeds {maximum} characters")
    return normalized


def _validate_coordinates(latitude: float | None, longitude: float | None) -> None:
    if (latitude is None) != (longitude is None):
        raise ValueError("coordinates must be supplied together")
    if latitude is None or longitude is None:
        return
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise ValueError("coordinates are invalid")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("coordinates are invalid")


def _validate_count(value: int | None, field: str) -> None:
    if value is not None and (isinstance(value, bool) or value < 0):
        raise ValueError(f"{field} must be non-negative")


def _safe_source_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    parsed = urlsplit(normalized)
    if parsed.scheme != "https":
        raise ValueError("source_url must use https")
    if not parsed.hostname or parsed.username or parsed.password or len(normalized) > 2048:
        raise ValueError("source_url is invalid")
    return normalized


def _json_dimensions(raw: EventInput) -> tuple[dict[str, JsonValue], str]:
    dimensions = dict(raw.dimensions)
    if any(not isinstance(key, str) for key in dimensions):
        raise ValueError("dimensions must be JSON")
    try:
        canonical = json.dumps(
            dimensions, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
    except (TypeError, ValueError) as error:
        raise ValueError("dimensions must be JSON") from error
    if len(canonical.encode("utf-8")) > 65_536:
        raise ValueError("dimensions exceed 65536 bytes")
    return dimensions, canonical


def _clamp_severity(value: float, flags: set[str]) -> float:
    clamped = min(100.0, max(0.0, value))
    if clamped != value:
        flags.add("severity_clamped")
    return clamped


def _normalized_severity(raw: EventInput, flags: set[str]) -> float | None:
    if raw.provider_severity is not None and not math.isfinite(raw.provider_severity):
        raise ValueError("provider_severity must be finite")
    if raw.source_code == "gdacs-events":
        alert_level = raw.dimensions.get("alert_level")
        value = _GDACS_ALERT_SEVERITY.get(str(alert_level).casefold())
    elif raw.source_code == "usgs-earthquakes":
        value = None if raw.provider_severity is None else raw.provider_severity * 10
    elif raw.source_code in {"gdelt-events", "nasa-eonet"}:
        value = raw.provider_severity
    else:
        raise ValueError(f"Unsupported event source: {raw.source_code}")
    if value is None:
        flags.add("severity_unavailable")
        return None
    return _clamp_severity(value, flags)


def normalize_event(raw: EventInput, observed_at: datetime) -> EventObservation:
    _require_aware(raw.occurred_at, "occurred_at")
    _require_aware(observed_at, "observed_at")
    source_event_key = _required_text(raw.source_event_key, "source_event_key", maximum=500)
    title = _required_text(raw.title, "title", maximum=4_000)
    flags = set(raw.quality_flags)
    raw_category = _required_text(raw.category, "category", maximum=100).casefold()
    category = _CATEGORY_ALIASES.get(raw_category, raw_category)
    if category not in _CANONICAL_CATEGORIES:
        category = "other"
        flags.add("unmapped_category")
    if raw.source_code not in _PARSER_VERSIONS:
        raise ValueError(f"Unsupported event source: {raw.source_code}")
    if any(not isinstance(flag, str) or not flag.strip() for flag in flags):
        raise ValueError("quality_flags must contain non-empty strings")
    _validate_coordinates(raw.latitude, raw.longitude)
    _validate_count(raw.affected_count, "affected_count")
    _validate_count(raw.fatalities, "fatalities")
    source_url = _safe_source_url(raw.source_url)
    dimensions, canonical_dimensions = _json_dimensions(raw)
    normalized_severity = _normalized_severity(raw, flags)
    occurred_at = raw.occurred_at.astimezone(timezone.utc)
    observed_at = observed_at.astimezone(timezone.utc)
    country = _optional_text(raw.country, maximum=100)
    country = country.upper() if country else None
    region = _optional_text(raw.region, maximum=500)
    subcategory = _optional_text(raw.subcategory, maximum=100)
    payload = {
        "affectedCount": raw.affected_count,
        "category": category,
        "country": country,
        "dimensions": canonical_dimensions,
        "fatalities": raw.fatalities,
        "latitude": raw.latitude,
        "longitude": raw.longitude,
        "occurredAt": occurred_at.isoformat(),
        "providerSeverity": raw.provider_severity,
        "region": region,
        "sourceCode": raw.source_code,
        "sourceEventKey": source_event_key,
        "subcategory": subcategory,
        "title": title,
    }
    content_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return EventObservation(
        source_code=raw.source_code,
        source_event_key=source_event_key,
        category=category,
        subcategory=subcategory,
        title=title,
        occurred_at=occurred_at,
        first_observed_at=observed_at,
        last_observed_at=observed_at,
        normalized_severity=normalized_severity,
        provider_severity=raw.provider_severity,
        country=country,
        region=region,
        latitude=raw.latitude,
        longitude=raw.longitude,
        affected_count=raw.affected_count,
        fatalities=raw.fatalities,
        source_url=source_url,
        parser_version=_PARSER_VERSIONS[raw.source_code],
        quality_flags=tuple(sorted(flags)),
        dimensions=dimensions,
        content_hash=content_hash,
    )
