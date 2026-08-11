from __future__ import annotations

import json
import random
import re
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

from .catalog import FEEDS
from .models import Bar
from .quality import normalize_bars


INTERVALS = {"1h": timedelta(hours=1), "1d": timedelta(days=1)}
INTERVAL_MILLISECONDS = {"1h": 3_600_000, "1d": 86_400_000}


class ProviderUnavailableError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ProviderInstrumentDescriptor:
    provider_symbol: str
    canonical_symbol: str
    name: str
    market: str
    venue: str | None
    currency: str


@dataclass(frozen=True)
class HttpJsonResponse:
    status: int
    headers: Mapping[str, str]
    payload: object


class HttpJsonTransport(Protocol):
    def get_json(self, url: str, *, timeout_seconds: float) -> HttpJsonResponse: ...


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        request: Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        return None


class UrllibJsonTransport:
    max_response_bytes = 8_000_000

    def __init__(self) -> None:
        self._opener = build_opener(_RejectRedirects())

    def get_json(self, url: str, *, timeout_seconds: float) -> HttpJsonResponse:
        request = Request(url, headers={"User-Agent": "RadarAsset/1.0"})
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                body = response.read(self.max_response_bytes + 1)
                if len(body) > self.max_response_bytes:
                    raise ProviderUnavailableError(
                        "response_limit", "Provider response exceeded the size limit."
                    )
                try:
                    payload = json.loads(body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise ProviderUnavailableError(
                        "invalid_response", "Provider response was not valid JSON."
                    ) from error
                return HttpJsonResponse(
                    status=int(response.status),
                    headers=dict(response.headers.items()),
                    payload=payload,
                )
        except HTTPError as error:
            return HttpJsonResponse(
                status=int(error.code),
                headers=dict(error.headers.items()) if error.headers else {},
                payload=None,
            )
        except (TimeoutError, URLError, OSError) as error:
            raise ProviderUnavailableError(
                "network_error", "Provider network request failed."
            ) from error


def only_closed_bars(
    rows: Iterable[Bar], *, timeframe: str, now: datetime
) -> list[Bar]:
    try:
        duration = INTERVALS[timeframe]
    except KeyError as error:
        raise ValueError("Unsupported provider timeframe.") from error
    return [row for row in rows if row.timestamp + duration <= now]


class BinanceSpotAdapter:
    base_url = "https://data-api.binance.vision/api/v3/klines"
    exchange_info_url = (
        "https://data-api.binance.vision/api/v3/exchangeInfo"
        "?symbolStatus=TRADING&showPermissionSets=false"
    )

    def __init__(
        self,
        *,
        transport: HttpJsonTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
        max_pages: int = 128,
        max_rows: int = 100_000,
        timeout_seconds: float = 15,
    ) -> None:
        if not 1 <= max_pages <= 512:
            raise ValueError("Binance max_pages is outside the supported range.")
        if not 100 <= max_rows <= 250_000:
            raise ValueError("Binance max_rows is outside the supported range.")
        self.transport = transport or UrllibJsonTransport()
        self.sleep = sleep
        self.jitter = jitter
        self.max_pages = max_pages
        self.max_rows = max_rows
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def normalize_symbol(asset: str, provider_symbol: str) -> tuple[str, str]:
        canonical = asset.strip().upper()
        symbol = provider_symbol.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{2,15}", canonical) or symbol != f"{canonical}USDT":
            raise ValueError("Binance symbol is not a canonical USDT spot pair.")
        return canonical, symbol

    def list_instruments(self) -> list[ProviderInstrumentDescriptor]:
        response = self.transport.get_json(
            self.exchange_info_url, timeout_seconds=self.timeout_seconds
        )
        if response.status != 200 or not isinstance(response.payload, dict):
            raise ProviderUnavailableError("provider_unavailable", "Provider catalog request failed.")
        rows = response.payload.get("symbols")
        if not isinstance(rows, list) or len(rows) > 5_000:
            raise ProviderUnavailableError("invalid_response", "Provider catalog response is invalid.")
        instruments: list[ProviderInstrumentDescriptor] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if (
                row.get("status") != "TRADING"
                or row.get("quoteAsset") != "USDT"
                or row.get("isSpotTradingAllowed") is not True
            ):
                continue
            base = str(row.get("baseAsset", "")).upper()
            symbol = str(row.get("symbol", "")).upper()
            try:
                canonical, provider_symbol = self.normalize_symbol(base, symbol)
            except ValueError:
                continue
            instruments.append(
                ProviderInstrumentDescriptor(
                    provider_symbol=provider_symbol,
                    canonical_symbol=canonical,
                    name=f"{canonical} / Tether",
                    market="crypto_spot",
                    venue="BINANCE",
                    currency="USDT",
                )
            )
        return sorted(instruments, key=lambda item: item.canonical_symbol)

    @staticmethod
    def parse_klines(
        payload: Iterable[list[Any]], *, asset: str, timeframe: str
    ) -> list[Bar]:
        rows: list[Bar] = []
        for item in payload:
            if len(item) < 12:
                raise ValueError("Binance kline payload is incomplete.")
            rows.append(
                Bar(
                    asset=asset,
                    timestamp=datetime.fromtimestamp(
                        int(item[0]) / 1000, tz=timezone.utc
                    ),
                    timeframe=timeframe,
                    open=Decimal(str(item[1])),
                    high=Decimal(str(item[2])),
                    low=Decimal(str(item[3])),
                    close=Decimal(str(item[4])),
                    volume=Decimal(str(item[5])),
                    source="binance-public-spot",
                )
            )
        return normalize_bars(rows)

    def _retry_delay(self, response: HttpJsonResponse, attempt: int) -> float:
        raw_retry_after = response.headers.get("Retry-After")
        if response.status == 429 and raw_retry_after is not None:
            try:
                return max(0.0, min(float(raw_retry_after), 60.0))
            except ValueError:
                pass
        return min((2**attempt) + max(0.0, min(self.jitter(), 1.0)), 60.0)

    def _request_page(self, url: str) -> list[Any]:
        last_code = "provider_unavailable"
        for attempt in range(3):
            try:
                response = self.transport.get_json(
                    url, timeout_seconds=self.timeout_seconds
                )
            except ProviderUnavailableError as error:
                last_code = error.code
                if attempt == 2:
                    raise ProviderUnavailableError(
                        last_code, "Provider request failed."
                    ) from error
                self.sleep(min((2**attempt) + self.jitter(), 60.0))
                continue
            if response.status == 200:
                if not isinstance(response.payload, list):
                    raise ProviderUnavailableError(
                        "invalid_response", "Provider response must be an array."
                    )
                return response.payload
            if response.status == 429 or 500 <= response.status <= 599:
                last_code = (
                    "rate_limited" if response.status == 429 else "provider_unavailable"
                )
                if attempt == 2:
                    break
                self.sleep(self._retry_delay(response, attempt))
                continue
            raise ProviderUnavailableError(
                "provider_rejected", "Provider rejected the request."
            )
        raise ProviderUnavailableError(last_code, "Provider request failed.")

    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        now: datetime | None = None,
    ) -> list[Bar]:
        asset, symbol = self.normalize_symbol(asset, symbol)
        if timeframe not in INTERVAL_MILLISECONDS:
            raise ValueError("Unsupported Binance timeframe.")
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Binance fetch requires an ordered timezone-aware range.")

        end_ms = int(end.timestamp() * 1000)
        cursor_ms = int(start.timestamp() * 1000)
        interval_ms = INTERVAL_MILLISECONDS[timeframe]
        payload: list[list[Any]] = []
        pages = 0

        while cursor_ms < end_ms:
            if pages >= self.max_pages:
                raise ProviderUnavailableError(
                    "response_limit", "Provider pagination exceeded the page limit."
                )
            params = urlencode(
                {
                    "symbol": symbol,
                    "interval": timeframe,
                    "startTime": cursor_ms,
                    "endTime": end_ms,
                    "limit": 1000,
                }
            )
            page = self._request_page(f"{self.base_url}?{params}")
            pages += 1
            if not page:
                break
            if not all(isinstance(item, list) and len(item) >= 12 for item in page):
                raise ProviderUnavailableError(
                    "invalid_response", "Provider returned an incomplete kline page."
                )
            try:
                timestamps = [int(item[0]) for item in page]
            except (TypeError, ValueError) as error:
                raise ProviderUnavailableError(
                    "invalid_response", "Provider returned an invalid timestamp."
                ) from error
            if timestamps != sorted(set(timestamps)) or timestamps[0] < cursor_ms:
                raise ProviderUnavailableError(
                    "invalid_response", "Provider returned non-monotonic klines."
                )
            next_cursor = timestamps[-1] + interval_ms
            if next_cursor <= cursor_ms:
                raise ProviderUnavailableError(
                    "invalid_response", "Provider pagination did not advance."
                )
            payload.extend(page)
            if len(payload) > self.max_rows:
                raise ProviderUnavailableError(
                    "response_limit", "Provider response exceeded the row limit."
                )
            cursor_ms = next_cursor

        try:
            normalized = self.parse_klines(payload, asset=asset, timeframe=timeframe)
        except (ArithmeticError, TypeError, ValueError) as error:
            raise ProviderUnavailableError(
                "invalid_response", "Provider returned invalid kline values."
            ) from error
        return only_closed_bars(
            normalized, timeframe=timeframe, now=now or datetime.now(timezone.utc)
        )


class CcxtSpotAdapter:
    def __init__(
        self,
        *,
        exchange: Any | None = None,
        exchange_id: str = "kraken",
        max_pages: int = 128,
        max_rows: int = 100_000,
    ) -> None:
        if not 1 <= max_pages <= 512 or not 100 <= max_rows <= 250_000:
            raise ValueError("CCXT limits are outside the supported range.")
        if exchange is None:
            try:
                import ccxt

                exchange = getattr(ccxt, exchange_id)({"enableRateLimit": True, "timeout": 15_000})
            except (ImportError, AttributeError) as error:
                raise ProviderUnavailableError("provider_unavailable", "CCXT is unavailable.") from error
        self.exchange = exchange
        self.exchange_id = str(getattr(exchange, "id", exchange_id))
        self.max_pages = max_pages
        self.max_rows = max_rows

    @staticmethod
    def unified_symbol(symbol: str) -> str:
        value = symbol.strip().upper()
        match = re.fullmatch(r"([A-Z0-9]{2,20})(USDT|USD)", value)
        if match is None:
            raise ValueError("Unsupported CCXT spot symbol.")
        return f"{match.group(1)}/USD"

    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        now: datetime | None = None,
    ) -> list[Bar]:
        if timeframe not in INTERVALS:
            raise ValueError("Unsupported provider timeframe.")
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("Provider boundaries must be timezone-aware.")
        since = int(start.astimezone(timezone.utc).timestamp() * 1000)
        end_ms = int(end.astimezone(timezone.utc).timestamp() * 1000)
        step_ms = INTERVAL_MILLISECONDS[timeframe]
        rows: list[Bar] = []
        try:
            self.exchange.load_markets()
            for _ in range(self.max_pages):
                page = self.exchange.fetch_ohlcv(
                    self.unified_symbol(symbol),
                    timeframe,
                    since=since,
                    limit=min(1000, self.max_rows),
                )
                if not page:
                    break
                timestamps = [int(item[0]) for item in page]
                if timestamps != sorted(timestamps) or len(set(timestamps)) != len(timestamps):
                    raise ProviderUnavailableError("invalid_response", "CCXT returned invalid ordering.")
                for item in page:
                    if not isinstance(item, (list, tuple)) or len(item) < 6:
                        raise ProviderUnavailableError("invalid_response", "CCXT returned an invalid candle.")
                    timestamp = datetime.fromtimestamp(int(item[0]) / 1000, tz=timezone.utc)
                    if timestamp > end.astimezone(timezone.utc):
                        continue
                    rows.append(
                        Bar(
                            asset=asset,
                            timestamp=timestamp,
                            timeframe=timeframe,
                            open=Decimal(str(item[1])),
                            high=Decimal(str(item[2])),
                            low=Decimal(str(item[3])),
                            close=Decimal(str(item[4])),
                            volume=None if item[5] is None else Decimal(str(item[5])),
                            source=f"ccxt:{self.exchange_id}",
                        )
                    )
                    if len(rows) > self.max_rows:
                        raise ProviderUnavailableError("response_limit", "CCXT row limit exceeded.")
                next_since = timestamps[-1] + step_ms
                if next_since <= since or next_since > end_ms:
                    break
                since = next_since
            else:
                raise ProviderUnavailableError("response_limit", "CCXT page limit exceeded.")
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError("provider_unavailable", "CCXT fallback failed.") from error
        if not rows:
            raise ProviderUnavailableError("provider_unavailable", "CCXT returned no bars.")
        return only_closed_bars(
            normalize_bars(rows), timeframe=timeframe, now=now or datetime.now(timezone.utc)
        )


class FallbackMarketDataProvider:
    def __init__(self, primary: Any, fallback: Any) -> None:
        self.primary = primary
        self.fallback = fallback

    def fetch(self, **kwargs: Any) -> list[Bar]:
        try:
            return self.primary.fetch(**kwargs)
        except ProviderUnavailableError as error:
            if error.code == "unsupported_timeframe":
                raise
            return self.fallback.fetch(**kwargs)


def _load_vnstock_market(
    import_market: Callable[[], Any] | None = None,
) -> Any:
    import vnai

    original_setup = vnai.async_setup_agent_environment
    vnai.async_setup_agent_environment = lambda *args, **kwargs: False
    try:
        if import_market is not None:
            return import_market()
        from vnstock.ui import Market

        return Market
    finally:
        vnai.async_setup_agent_environment = original_setup


def _default_market_factory() -> Any:
    Market = _load_vnstock_market()

    return Market()


class VnstockAdapter:
    def __init__(
        self,
        *,
        market_factory: Callable[[], Any] = _default_market_factory,
        max_rows: int = 100_000,
    ) -> None:
        if not 100 <= max_rows <= 250_000:
            raise ValueError("Vnstock max_rows is outside the supported range.")
        self.market_factory = market_factory
        self.max_rows = max_rows

    @staticmethod
    def normalize_symbol(asset: str, provider_symbol: str) -> tuple[str, str]:
        canonical = asset.strip().upper()
        symbol = provider_symbol.strip().upper()
        if canonical == "XAU" and symbol == "XAUUSD":
            return canonical, symbol
        if not re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", canonical) or symbol != canonical:
            raise ValueError("Vnstock symbol is not a supported canonical instrument.")
        return canonical, symbol

    def list_instruments(self) -> list[ProviderInstrumentDescriptor]:
        return [
            ProviderInstrumentDescriptor(
                provider_symbol=feed.provider_symbol,
                canonical_symbol=feed.symbol,
                name=feed.asset_name,
                market=feed.market,
                venue=feed.venue,
                currency=feed.currency,
            )
            for feed in sorted(FEEDS.values(), key=lambda item: item.symbol)
            if feed.provider_code in {"vnstock-vci-free", "msn-via-vnstock"}
        ]

    @staticmethod
    def parse_records(
        records: Iterable[dict[str, Any]],
        *,
        asset: str,
        timeframe: str,
        source: str,
        naive_timezone: str = "Asia/Ho_Chi_Minh",
    ) -> list[Bar]:
        rows: list[Bar] = []
        local_zone = ZoneInfo(naive_timezone)
        for record in records:
            raw_time = record.get("time")
            if isinstance(raw_time, datetime):
                timestamp = raw_time
            elif isinstance(raw_time, str):
                timestamp = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
            else:
                raise ValueError("Vnstock row is missing a valid time field.")
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=local_zone)
            rows.append(
                Bar(
                    asset=asset,
                    timestamp=timestamp.astimezone(timezone.utc),
                    timeframe=timeframe,
                    open=Decimal(str(record["open"])),
                    high=Decimal(str(record["high"])),
                    low=Decimal(str(record["low"])),
                    close=Decimal(str(record["close"])),
                    volume=(
                        None
                        if record.get("volume") is None
                        else Decimal(str(record["volume"]))
                    ),
                    source=source,
                )
            )
        return normalize_bars(rows)

    def fetch(
        self,
        *,
        symbol: str,
        asset: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        now: datetime | None = None,
    ) -> list[Bar]:
        asset, symbol = self.normalize_symbol(asset, symbol)
        if timeframe not in INTERVALS:
            raise ValueError("Unsupported Vnstock timeframe.")
        is_metal = asset == "XAU" and symbol == "XAUUSD"
        if is_metal and timeframe == "1h":
            raise ProviderUnavailableError(
                "unsupported_timeframe",
                "The free XAU/USD provider does not supply hourly candles.",
            )
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Vnstock fetch requires an ordered timezone-aware range.")

        try:
            market = self.market_factory()
            instrument = (
                market.commodity(symbol)
                if is_metal
                else market.equity(symbol, source="VCI")
            )
            frame = instrument.ohlcv(
                start=start.date().isoformat(),
                end=end.date().isoformat(),
                interval=timeframe,
                count=self.max_rows,
            )
            records = frame.to_dict("records")
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError(
                "provider_unavailable", "Provider request failed."
            ) from error

        if not isinstance(records, list) or not records:
            raise ProviderUnavailableError(
                "provider_unavailable", "Provider returned no bars."
            )
        if len(records) > self.max_rows:
            raise ProviderUnavailableError(
                "response_limit", "Provider response exceeded the row limit."
            )
        required = {"time", "open", "high", "low", "close"}
        if any(not isinstance(record, dict) or not required <= record.keys() for record in records):
            raise ProviderUnavailableError(
                "invalid_response", "Provider response schema is invalid."
            )

        sanitized_records: list[dict[str, Any]] = []
        try:
            for record in records:
                prices = tuple(
                    Decimal(str(record[field]))
                    for field in ("open", "high", "low", "close")
                )
                if any(not value.is_finite() or value <= 0 for value in prices):
                    continue
                sanitized = dict(record)
                if sanitized.get("volume") is not None:
                    volume = Decimal(str(sanitized["volume"]))
                    if not volume.is_finite() or volume < 0:
                        sanitized["volume"] = None
                sanitized_records.append(sanitized)
        except (ArithmeticError, TypeError, ValueError) as error:
            raise ProviderUnavailableError(
                "invalid_response", "Provider returned invalid market data."
            ) from error
        if not sanitized_records:
            raise ProviderUnavailableError(
                "invalid_response", "Provider returned no valid market bars."
            )

        feed = FEEDS.get(asset)
        source = "msn-via-vnstock" if is_metal else "vnstock-vci-free"
        naive_timezone = feed.naive_timezone if feed is not None else "Asia/Ho_Chi_Minh"
        try:
            normalized = self.parse_records(
                sanitized_records,
                asset=asset,
                timeframe=timeframe,
                source=source,
                naive_timezone=naive_timezone,
            )
        except (ArithmeticError, KeyError, TypeError, ValueError) as error:
            raise ProviderUnavailableError(
                "invalid_response", "Provider returned invalid market data."
            ) from error
        return only_closed_bars(
            normalized, timeframe=timeframe, now=now or datetime.now(timezone.utc)
        )
