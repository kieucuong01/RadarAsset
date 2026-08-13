from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from urllib.parse import urlsplit


class Market(StrEnum):
    CRYPTO = "crypto"
    MACRO = "macro"
    GOLD = "gold"


class CollectionMode(StrEnum):
    API = "api"
    SCRAPLING = "scrapling"
    MANUAL = "manual"
    DISABLED = "disabled"


class LicenseScope(StrEnum):
    RESEARCH_ONLY = "research_only"
    PUBLIC_OFFICIAL = "public_official"


def _require_aware(value: datetime | None, field_name: str) -> None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError(f"{field_name} must be timezone-aware.")


def _require_https(url: str, field_name: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"{field_name} must use HTTPS.")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} must not contain credentials.")


@dataclass(frozen=True, slots=True)
class SourceDefinition:
    code: str
    name: str
    market: Market
    collection_mode: CollectionMode
    license_scope: LicenseScope
    urls: tuple[str, ...]
    schedule: str
    freshness_sla_minutes: int
    parser_version: str
    quality_tier: Decimal
    terms_url: str | None = None
    enabled: bool = False
    max_rows: int = 50_000

    def __post_init__(self) -> None:
        if not self.code or not self.name or not self.schedule or not self.parser_version:
            raise ValueError("Source identity, schedule, and parser version are required.")
        if not self.urls:
            raise ValueError("At least one source URL is required.")
        for url in self.urls:
            _require_https(url, "Source URL")
        if self.terms_url is not None:
            _require_https(self.terms_url, "Terms URL")
        if self.freshness_sla_minutes <= 0:
            raise ValueError("Freshness SLA must be positive.")
        if not Decimal("0") < self.quality_tier <= Decimal("1"):
            raise ValueError("Quality tier must be greater than zero and at most one.")
        if self.max_rows <= 0:
            raise ValueError("Source row limit must be positive.")


@dataclass(frozen=True, slots=True)
class RawSnapshot:
    content: bytes
    content_type: str
    source_url: str
    effective_at: datetime | None
    published_at: datetime | None
    observed_at: datetime
    metadata: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.content, bytes):
            raise TypeError("Snapshot content must be bytes.")
        if not self.content_type:
            raise ValueError("Snapshot content type is required.")
        _require_https(self.source_url, "Snapshot source URL")
        _require_aware(self.effective_at, "effective_at")
        _require_aware(self.published_at, "published_at")
        _require_aware(self.observed_at, "observed_at")


@dataclass(frozen=True, slots=True)
class ObservationInput:
    metric_code: str
    value: Decimal
    effective_at: datetime
    effective_start: datetime | None = None
    effective_end: datetime | None = None
    published_at: datetime | None = None
    asset_symbol: str | None = None
    dimensions: Mapping[str, str] = field(default_factory=dict)
    quality_status: str = "passed"
    quality_flags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if (self.effective_start is None) != (self.effective_end is None):
            raise ValueError("effective_start and effective_end must both be present.")
        if self.effective_end is not None:
            if self.effective_start is not None and self.effective_start > self.effective_end:
                raise ValueError("Observation period start must not follow its period end.")
            if self.effective_at != self.effective_end:
                raise ValueError("Observation effective_at must equal the period end.")

    @property
    def dimension_key(self) -> str:
        return json.dumps(
            dict(sorted(self.dimensions.items())),
            separators=(",", ":"),
            ensure_ascii=True,
        )


@dataclass(frozen=True, slots=True)
class SourceRunResult:
    source_code: str
    status: str
    records_fetched: int
    error_code: str | None
    retry_count: int
    started_at: datetime
    finished_at: datetime

    def __post_init__(self) -> None:
        _require_aware(self.started_at, "started_at")
        _require_aware(self.finished_at, "finished_at")
        if self.finished_at < self.started_at:
            raise ValueError("A source run cannot finish before it started.")
        if self.records_fetched < 0 or self.retry_count < 0:
            raise ValueError("Source run counts must be non-negative.")
