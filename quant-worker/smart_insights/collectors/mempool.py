from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


_FEE_METRICS = {
    "fastestFee": "crypto.network.fee.fastest_sat_vb",
    "halfHourFee": "crypto.network.fee.half_hour_sat_vb",
    "hourFee": "crypto.network.fee.hour_sat_vb",
    "economyFee": "crypto.network.fee.economy_sat_vb",
    "minimumFee": "crypto.network.fee.minimum_sat_vb",
}
_MEMPOOL_METRICS = {
    "count": "crypto.network.mempool.transaction_count",
    "vsize": "crypto.network.mempool.vsize_bytes",
    "total_fee": "crypto.network.mempool.total_fee_sats",
}


def _decimal(value: object) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError) as error:
        raise ValueError("INVALID_VALUE") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError("INVALID_VALUE")
    return parsed


class MempoolSpaceCollector:
    def __init__(self, *, transport: Any | None = None) -> None:
        self.source = source_for_code("mempool-space")
        self._transport = transport or UrllibTransport()

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        payloads: dict[str, object] = {}
        for url in self.source.urls:
            response = self._transport.fetch(
                url, timeout_seconds=30, max_bytes=10_000_000
            )
            if response.status != 200 or response.url != url:
                raise SourceFetchError("INVALID_RESPONSE")
            try:
                payloads[url] = json.loads(response.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                payloads[url] = None
        snapshot = RawSnapshot(
            content=json.dumps(
                payloads, sort_keys=True, separators=(",", ":")
            ).encode("utf-8"),
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=as_of,
            metadata={
                "endpoints": self.source.urls,
                "parser_version": self.source.parser_version,
            },
        )
        fees = payloads.get(self.source.urls[0])
        mempool = payloads.get(self.source.urls[1])
        mining = payloads.get(self.source.urls[2])
        if not isinstance(fees, dict) or not isinstance(mempool, dict) or not isinstance(mining, dict):
            return CollectionBatch(self.source, snapshot, (), "SCHEMA_DRIFT")

        observations: list[ObservationInput] = []
        try:
            for provider_metric, metric_code in _FEE_METRICS.items():
                observations.append(
                    self._instant(metric_code, provider_metric, fees[provider_metric], as_of)
                )
            for provider_metric, metric_code in _MEMPOOL_METRICS.items():
                observations.append(
                    self._instant(metric_code, provider_metric, mempool[provider_metric], as_of)
                )
            observations.extend(self._mining_rows(mining, as_of))
        except (KeyError, ValueError) as error:
            return CollectionBatch(self.source, snapshot, (), str(error).strip("'"))
        return CollectionBatch(self.source, snapshot, tuple(observations))

    @staticmethod
    def _instant(
        metric_code: str, provider_metric: str, value: object, as_of: datetime
    ) -> ObservationInput:
        return ObservationInput(
            metric_code=metric_code,
            value=_decimal(value),
            effective_at=as_of,
            asset_symbol="BTC",
            dimensions={"provider_metric": provider_metric, "frequency": "instant"},
        )

    def _mining_rows(
        self, payload: dict[str, object], as_of: datetime
    ) -> list[ObservationInput]:
        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        hashrates = payload.get("hashrates")
        difficulties = payload.get("difficulty")
        if not isinstance(hashrates, list) or not isinstance(difficulties, list):
            raise ValueError("SCHEMA_DRIFT")
        result: list[ObservationInput] = []
        seen: set[tuple[str, datetime]] = set()
        for provider_metric, metric_code, rows, time_key, value_key in (
            ("avgHashrate", "crypto.network.hashrate_hs", hashrates, "timestamp", "avgHashrate"),
            ("difficulty", "crypto.network.difficulty", difficulties, "time", "difficulty"),
        ):
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError("SCHEMA_DRIFT")
                try:
                    effective_at = datetime.fromtimestamp(
                        int(str(row[time_key])), timezone.utc
                    )
                    value = _decimal(row[value_key])
                except (KeyError, ValueError, OverflowError, OSError) as error:
                    raise ValueError("INVALID_VALUE") from error
                if effective_at >= cutoff:
                    continue
                key = (metric_code, effective_at)
                if key in seen:
                    raise ValueError("DUPLICATE_PERIOD")
                seen.add(key)
                result.append(
                    ObservationInput(
                        metric_code=metric_code,
                        value=value,
                        effective_at=effective_at,
                        asset_symbol="BTC",
                        dimensions={
                            "provider_metric": provider_metric,
                            "frequency": "daily",
                        },
                    )
                )
        for provider_metric, metric_code in (
            ("currentHashrate", "crypto.network.hashrate_hs"),
            ("currentDifficulty", "crypto.network.difficulty"),
        ):
            if provider_metric in payload:
                result.append(
                    self._instant(metric_code, provider_metric, payload[provider_metric], as_of)
                )
        return result
