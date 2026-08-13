from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.http import SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


_CURRENCIES = ("BTC", "ETH")
_INSTRUMENTS = {"BTC-PERPETUAL": "BTC", "ETH-PERPETUAL": "ETH"}


def _decimal(value: object) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError) as error:
        raise ValueError("INVALID_VALUE") from error
    if not result.is_finite():
        raise ValueError("INVALID_VALUE")
    return result


def _millisecond_time(value: object) -> datetime:
    try:
        return datetime.fromtimestamp(int(str(value)) / 1000, timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError) as error:
        raise ValueError("INVALID_TIMESTAMP") from error


class DeribitCollector:
    def __init__(
        self,
        *,
        transport: Any | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.source = source_for_code("deribit-public")
        self._transport = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        cutoff = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = cutoff - timedelta(days=370)
        responses: dict[str, object] = {}
        for currency in _CURRENCIES:
            url = f"{self.source.urls[0]}?{urlencode({'currency': currency, 'start_timestamp': int(start.timestamp() * 1000), 'end_timestamp': int(cutoff.timestamp() * 1000), 'resolution': '1D'})}"
            responses[f"{currency.lower()}_dvol"] = self._fetch(url)
        for instrument in _INSTRUMENTS:
            url = f"{self.source.urls[1]}?{urlencode({'instrument_name': instrument})}"
            responses[f"{instrument.lower()}_ticker"] = self._fetch(url)

        provider_times = tuple(
            _millisecond_time(payload["result"].get("timestamp"))
            for key, payload in responses.items()
            if key.endswith("_ticker")
            and isinstance(payload, dict)
            and isinstance(payload.get("result"), dict)
        )
        observed_at = max((as_of, self._clock(), *provider_times))

        snapshot = RawSnapshot(
            content=json.dumps(
                responses, sort_keys=True, separators=(",", ":")
            ).encode("utf-8"),
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=None,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "currencies": _CURRENCIES,
                "instruments": tuple(_INSTRUMENTS),
                "parser_version": self.source.parser_version,
            },
        )
        try:
            observations = self._parse(
                responses, as_of=observed_at, cutoff=cutoff
            )
        except ValueError as error:
            return CollectionBatch(self.source, snapshot, (), str(error))
        return CollectionBatch(self.source, snapshot, tuple(observations))

    def _fetch(self, url: str) -> object:
        response = self._transport.fetch(
            url, timeout_seconds=30, max_bytes=10_000_000
        )
        if response.status != 200 or response.url != url:
            raise SourceFetchError("INVALID_RESPONSE")
        try:
            return json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SourceFetchError("INVALID_RESPONSE") from error

    def _parse(
        self,
        responses: dict[str, object],
        *,
        as_of: datetime,
        cutoff: datetime,
    ) -> list[ObservationInput]:
        observations: list[ObservationInput] = []
        for currency in _CURRENCIES:
            payload = responses.get(f"{currency.lower()}_dvol")
            result = payload.get("result") if isinstance(payload, dict) else None
            rows = result.get("data") if isinstance(result, dict) else None
            if not isinstance(rows, list):
                raise ValueError("SCHEMA_DRIFT")
            seen: set[datetime] = set()
            for raw in rows:
                if not isinstance(raw, list) or len(raw) != 5:
                    raise ValueError("SCHEMA_DRIFT")
                effective_at = _millisecond_time(raw[0])
                if effective_at >= cutoff:
                    continue
                if effective_at != effective_at.replace(
                    hour=0, minute=0, second=0, microsecond=0
                ):
                    raise ValueError("INVALID_TIMESTAMP")
                if effective_at in seen:
                    raise ValueError("DUPLICATE_PERIOD")
                seen.add(effective_at)
                open_value, high, low, close = map(_decimal, raw[1:])
                if min(open_value, high, low, close) < 0 or not (
                    low <= open_value <= high and low <= close <= high
                ):
                    raise ValueError("INVALID_VALUE")
                base_code = f"crypto.derivatives.{currency.lower()}_dvol"
                for suffix, value in (
                    ("", close),
                    (".open", open_value),
                    (".high", high),
                    (".low", low),
                ):
                    observations.append(
                        ObservationInput(
                            metric_code=f"{base_code}{suffix}",
                            value=value,
                            effective_at=effective_at,
                            asset_symbol=currency,
                            dimensions={
                                "provider_metric": "DVOL",
                                "field": "close" if not suffix else suffix[1:],
                                "frequency": "daily",
                            },
                        )
                    )

        for instrument, currency in _INSTRUMENTS.items():
            payload = responses.get(f"{instrument.lower()}_ticker")
            result = payload.get("result") if isinstance(payload, dict) else None
            if not isinstance(result, dict):
                raise ValueError("SCHEMA_DRIFT")
            if result.get("instrument_name") != instrument:
                raise ValueError("UNKNOWN_INSTRUMENT")
            observed_at = _millisecond_time(result.get("timestamp"))
            if observed_at > as_of or as_of - observed_at > timedelta(minutes=15):
                raise ValueError("INVALID_TIMESTAMP")
            for field, suffix in (
                ("current_funding", "funding_rate"),
                ("open_interest", "open_interest"),
            ):
                observations.append(
                    ObservationInput(
                        metric_code=f"crypto.derivatives.{suffix}",
                        value=_decimal(result.get(field)),
                        effective_at=observed_at,
                        asset_symbol=currency,
                        dimensions={
                            "instrument": instrument,
                            "provider_metric": field,
                            "frequency": "instant",
                        },
                    )
                )
        return observations
