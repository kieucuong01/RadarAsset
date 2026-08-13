from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


def _number(value: object) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError) as error:
        raise ValueError("INVALID_VALUE") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError("INVALID_VALUE")
    return parsed


class _DefiLlamaCollector:
    source_code: str

    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code(self.source_code)
        self._transport = transport or UrllibTransport()

    def _fetch(self, as_of: datetime) -> tuple[RawSnapshot, object]:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        url = self.source.urls[0]
        response = self._transport.fetch(
            url, timeout_seconds=30, max_bytes=10_000_000
        )
        if response.status != 200 or response.url != url:
            raise SourceFetchError("INVALID_RESPONSE")
        snapshot = RawSnapshot(
            content=response.body,
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=as_of,
            metadata={
                "attribution": "DefiLlama",
                "parser_version": self.source.parser_version,
            },
        )
        try:
            return snapshot, json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return snapshot, None


class DefiLlamaStablecoinsCollector(_DefiLlamaCollector):
    source_code = "defillama-stablecoins"

    def collect(self, as_of: datetime) -> CollectionBatch:
        snapshot, payload = self._fetch(as_of)
        if not isinstance(payload, list):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        observations: list[ObservationInput] = []
        seen: set[datetime] = set()
        try:
            for row in payload:
                if not isinstance(row, dict) or not isinstance(
                    row.get("totalCirculatingUSD"), dict
                ):
                    raise ValueError("SCHEMA_DRIFT")
                effective_at = datetime.fromtimestamp(
                    int(str(row["date"])), timezone.utc
                )
                if effective_at in seen:
                    raise ValueError("DUPLICATE_SERIES")
                seen.add(effective_at)
                if effective_at >= cutoff:
                    continue
                buckets = row["totalCirculatingUSD"]
                assert isinstance(buckets, dict)
                total = sum((_number(value) for value in buckets.values()), Decimal("0"))
                observations.append(
                    ObservationInput(
                        metric_code="crypto.stablecoin.supply_usd",
                        value=total,
                        effective_at=effective_at,
                        dimensions={
                            "scope": "all",
                            "frequency": "daily",
                            "peg_buckets": str(len(buckets)),
                        },
                    )
                )
        except (KeyError, ValueError, OverflowError, OSError) as error:
            return CollectionBatch(self.source, snapshot, (), str(error).strip("'"))
        observations.sort(key=lambda row: row.effective_at)
        return CollectionBatch(self.source, snapshot, tuple(observations))


class DefiLlamaChainsCollector(_DefiLlamaCollector):
    source_code = "defillama-chains"

    def collect(self, as_of: datetime) -> CollectionBatch:
        snapshot, payload = self._fetch(as_of)
        if not isinstance(payload, list):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")
        observations: list[ObservationInput] = []
        names: set[str] = set()
        total = Decimal("0")
        try:
            for row in payload:
                if not isinstance(row, dict) or not isinstance(row.get("name"), str):
                    raise ValueError("SCHEMA_DRIFT")
                name = row["name"].strip()
                normalized = name.casefold()
                if not name or normalized in names:
                    raise ValueError("DUPLICATE_SERIES")
                names.add(normalized)
                tvl = _number(row.get("tvl"))
                total += tvl
                observations.append(
                    ObservationInput(
                        metric_code="crypto.defi.chain_tvl_usd",
                        value=tvl,
                        effective_at=as_of,
                        dimensions={
                            "chain": name,
                            "token_symbol": str(row.get("tokenSymbol") or ""),
                            "frequency": "observed_daily",
                        },
                    )
                )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        observations.append(
            ObservationInput(
                metric_code="crypto.defi.chain_tvl_usd",
                value=total,
                effective_at=as_of,
                dimensions={"chain": "TOTAL", "frequency": "observed_daily"},
            )
        )
        return CollectionBatch(self.source, snapshot, tuple(observations))
