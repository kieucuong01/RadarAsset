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

from .catalog import DEFAULT_CRYPTO_UNIVERSE, FEEDS
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
        allowed_assets: Iterable[str] = DEFAULT_CRYPTO_UNIVERSE,
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
        self.allowed_assets = {asset.strip().upper() for asset in allowed_assets}
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
        seen_assets: set[str] = set()
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
            if base not in self.allowed_assets:
                continue
            try:
                canonical, provider_symbol = self.normalize_symbol(base, symbol)
            except ValueError:
                continue
            seen_assets.add(canonical)
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
        for missing in sorted(self.allowed_assets - seen_assets):
            instruments.append(
                ProviderInstrumentDescriptor(
                    provider_symbol=f"{missing}USDT",
                    canonical_symbol=missing,
                    name=f"{missing} / Tether",
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


def _default_dukascopy_fetcher(**kwargs: Any) -> Any:
    try:
        import dukascopy_python
    except ImportError as error:
        raise ProviderUnavailableError(
            "provider_unavailable", "Dukascopy dependency is unavailable."
        ) from error
    return dukascopy_python.fetch(**kwargs)


class DukascopyXauAdapter:
    intervals = {"1d": "1DAY", "1h": "1HOUR"}

    def __init__(
        self,
        *,
        fetcher: Callable[..., Any] = _default_dukascopy_fetcher,
        max_rows: int = 250_000,
    ) -> None:
        if not 100 <= max_rows <= 250_000:
            raise ValueError("Dukascopy max_rows is outside the supported range.")
        self.fetcher = fetcher
        self.max_rows = max_rows

    @staticmethod
    def _records(frame: Any) -> list[dict[str, Any]]:
        if hasattr(frame, "reset_index"):
            frame = frame.reset_index()
        if hasattr(frame, "to_dict"):
            records = frame.to_dict("records")
        else:
            records = frame
        return records if isinstance(records, list) else []

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
        if asset.strip().upper() != "XAU" or symbol.strip().upper() != "XAUUSD":
            raise ValueError("Dukascopy adapter only supports canonical XAUUSD.")
        if timeframe not in self.intervals:
            raise ValueError("Unsupported Dukascopy timeframe.")
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Dukascopy fetch requires an ordered timezone-aware range.")

        chunk_days = 365 if timeframe == "1h" else 3653
        cursor = start.astimezone(timezone.utc)
        end_utc = end.astimezone(timezone.utc)
        rows: list[Bar] = []
        try:
            while cursor < end_utc:
                chunk_end = min(end_utc, cursor + timedelta(days=chunk_days))
                frame = self.fetcher(
                    instrument="XAU/USD",
                    interval=self.intervals[timeframe],
                    offer_side="B",
                    start=cursor,
                    end=chunk_end,
                    max_retries=3,
                    limit=30_000,
                )
                for record in self._records(frame):
                    raw_timestamp = record.get("timestamp")
                    if not isinstance(raw_timestamp, datetime):
                        raise ValueError("Dukascopy row is missing a timestamp.")
                    timestamp = raw_timestamp
                    if timestamp.tzinfo is None:
                        timestamp = timestamp.replace(tzinfo=timezone.utc)
                    rows.append(
                        Bar(
                            asset="XAU",
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
                            source="dukascopy-public-bid",
                        )
                    )
                    if len(rows) > self.max_rows:
                        raise ProviderUnavailableError(
                            "response_limit", "Dukascopy response exceeded the row limit."
                        )
                cursor = chunk_end
        except ProviderUnavailableError:
            raise
        except Exception as error:
            raise ProviderUnavailableError(
                "network_error", "Dukascopy request failed."
            ) from error
        if not rows:
            raise ProviderUnavailableError(
                "provider_unavailable", "Dukascopy returned no bars."
            )
        try:
            normalized = normalize_bars(rows)
        except (ArithmeticError, TypeError, ValueError) as error:
            raise ProviderUnavailableError(
                "invalid_response", "Dukascopy returned invalid market data."
            ) from error
        return only_closed_bars(
            normalized, timeframe=timeframe, now=now or datetime.now(timezone.utc)
        )


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


def _default_listing_factory() -> Any:
    _load_vnstock_market()
    from vnstock import Listing

    return Listing()


class VnstockAdapter:
    def __init__(
        self,
        *,
        market_factory: Callable[[], Any] = _default_market_factory,
        listing_factory: Callable[[], Any] | None = _default_listing_factory,
        sleep: Callable[[float], None] = time.sleep,
        max_rows: int = 100_000,
    ) -> None:
        if not 100 <= max_rows <= 250_000:
            raise ValueError("Vnstock max_rows is outside the supported range.")
        self.market_factory = market_factory
        self.listing_factory = listing_factory
        self.sleep = sleep
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

    @staticmethod
    def _frame_records(frame: Any) -> list[dict[str, Any]]:
        if hasattr(frame, "to_dict"):
            records = frame.to_dict("records")
        else:
            records = frame
        return records if isinstance(records, list) else []

    @staticmethod
    def _record_value(record: Mapping[str, Any], keys: tuple[str, ...]) -> str:
        for key in keys:
            value = record.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    @staticmethod
    def _is_hose_record(record: Mapping[str, Any], *, already_scoped: bool) -> bool:
        value = VnstockAdapter._record_value(
            record,
            ("exchange", "floor", "board", "comGroupCode", "organTypeCode", "stockExchange"),
        ).upper()
        if not value:
            return already_scoped
        return value in {"HOSE", "HSX", "STOCK_HOSE"}

    def _listing_records(self) -> tuple[list[dict[str, Any]], bool]:
        if self.listing_factory is None:
            return [], False
        listing = self.listing_factory()
        for name in ("symbols_by_exchange", "list_by_exchange"):
            method = getattr(listing, name, None)
            if not callable(method):
                continue
            for args, kwargs in ((("HOSE",), {}), ((), {"exchange": "HOSE"})):
                try:
                    records = self._frame_records(method(*args, **kwargs))
                except TypeError:
                    continue
                if records:
                    return records, True
        method = getattr(listing, "all_symbols", None)
        if callable(method):
            return self._frame_records(method()), False
        return [], False

    def _dynamic_hose_instruments(self) -> list[ProviderInstrumentDescriptor]:
        try:
            records, already_scoped = self._listing_records()
        except Exception:
            return []
        instruments: dict[str, ProviderInstrumentDescriptor] = {}
        for record in records:
            if not isinstance(record, Mapping) or not self._is_hose_record(
                record, already_scoped=already_scoped
            ):
                continue
            instrument_type = self._record_value(record, ("type", "instrumentType")).lower()
            if instrument_type and instrument_type != "stock":
                continue
            symbol = self._record_value(record, ("symbol", "ticker", "code")).upper()
            if not re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", symbol):
                continue
            name = self._record_value(
                record,
                ("organ_name", "company_name", "name", "short_name", "organName"),
            )
            instruments[symbol] = ProviderInstrumentDescriptor(
                provider_symbol=symbol,
                canonical_symbol=symbol,
                name=name or symbol,
                market="vn_equity",
                venue="HOSE",
                currency="VND",
            )
        return [instruments[symbol] for symbol in sorted(instruments)]

    def list_instruments(self) -> list[ProviderInstrumentDescriptor]:
        dynamic_hose = self._dynamic_hose_instruments()
        fallback_feeds = [
            ProviderInstrumentDescriptor(
                provider_symbol=feed.provider_symbol,
                canonical_symbol=feed.symbol,
                name=feed.asset_name,
                market=feed.market,
                venue=feed.venue,
                currency=feed.currency,
            )
            for feed in sorted(FEEDS.values(), key=lambda item: item.symbol)
            if feed.provider_code in {"vnstock-vci-free", "vnstock-kbs-free"}
        ]
        if not dynamic_hose:
            return fallback_feeds
        existing = {item.canonical_symbol for item in dynamic_hose}
        return [
            *dynamic_hose,
            *[
                item
                for item in fallback_feeds
                if item.market != "vn_equity" and item.canonical_symbol not in existing
            ],
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
        is_index = asset == "VNINDEX" and symbol == "VNINDEX"
        if is_metal and timeframe == "1h":
            raise ProviderUnavailableError(
                "unsupported_timeframe",
                "The free XAU/USD provider does not supply hourly candles.",
            )
        if is_index and timeframe != "1d":
            raise ProviderUnavailableError(
                "unsupported_timeframe",
                "The VNINDEX benchmark feed is daily only.",
            )
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Vnstock fetch requires an ordered timezone-aware range.")
        provider_start = start
        if is_index:
            try:
                free_history_start = end.replace(year=end.year - 8)
            except ValueError:
                free_history_start = end.replace(year=end.year - 8, day=28)
            provider_start = max(start, free_history_start)

        records: Any = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                market = self.market_factory()
                if is_metal:
                    instrument = market.commodity(symbol)
                elif is_index:
                    instrument = market.index(symbol)
                else:
                    instrument = market.equity(symbol, source="VCI")
                request = {
                    "start": provider_start.date().isoformat(),
                    "end": end.date().isoformat(),
                    "interval": timeframe,
                    "count": self.max_rows,
                }
                if is_index:
                    request["source"] = "KBS"
                frame = instrument.ohlcv(**request)
                records = frame.to_dict("records")
                break
            except ProviderUnavailableError:
                raise
            except Exception as error:
                last_error = error
                if attempt < 2:
                    self.sleep(float(attempt + 1))
        if records is None:
            raise ProviderUnavailableError(
                "provider_unavailable", "Provider request failed."
            ) from last_error

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
                open_price, high_price, low_price, close_price = prices
                if not (
                    low_price <= open_price <= high_price
                    and low_price <= close_price <= high_price
                ):
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
        source = (
            "msn-via-vnstock"
            if is_metal
            else "vnstock-kbs-index"
            if is_index
            else "vnstock-vci-free"
        )
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
