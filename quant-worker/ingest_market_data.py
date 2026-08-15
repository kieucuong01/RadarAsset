from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Sequence
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

from backtest.catalog import FEEDS
from backtest.ingestion import IngestionSelection, run_ingestion
from backtest.ingestion_repository import PostgresIngestionRepository
from backtest.providers import (
    BinanceSpotAdapter,
    CcxtSpotAdapter,
    DukascopyXauAdapter,
    FallbackMarketDataProvider,
    VnstockAdapter,
)


class CliUsageError(ValueError):
    pass


class StrictArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CliUsageError(message)


def read_bounded_environment_integer(
    name: str,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return value


def supports_scheduled_timeframe(asset: str, timeframe: str) -> bool:
    return not (asset in {"VNINDEX", "VN30"} and timeframe == "1h")


def load_database_url(env_file: Path) -> str:
    existing = os.getenv("DATABASE_URL")
    if existing:
        return existing
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ValueError("DATABASE_URL is not configured.") from error
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith("DATABASE_URL="):
            continue
        value = line.removeprefix("DATABASE_URL=").strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if not value or "\n" in value or "\r" in value:
            break
        os.environ["DATABASE_URL"] = value
        return value
    raise ValueError("DATABASE_URL is not configured.")


def psycopg_connection_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    parameters = parse_qsl(parsed.query, keep_blank_values=True)
    schema_values = [value for key, value in parameters if key == "schema"]
    if any(value != "public" for value in schema_values):
        raise ValueError("Only the public database schema is supported.")
    psycopg_query = urlencode(
        [(key, value) for key, value in parameters if key != "schema"]
    )
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, psycopg_query, parsed.fragment)
    )


def build_selections(
    command: str,
    *,
    asset: str | None,
    timeframe: str | None,
) -> list[IngestionSelection]:
    if (asset is None) != (timeframe is None):
        raise ValueError("Single-feed ingestion requires both asset and timeframe.")
    if asset is not None and timeframe is not None:
        if command != "all":
            raise ValueError("Single-feed selection cannot be combined with a schedule command.")
        return [IngestionSelection(asset, timeframe)]
    if command == "hourly":
        return [
            IngestionSelection(symbol, "1h")
            for symbol in FEEDS
            if supports_scheduled_timeframe(symbol, "1h")
        ]
    if command == "daily":
        return [IngestionSelection(symbol, "1d") for symbol in FEEDS]
    if command == "all":
        return [
            IngestionSelection(symbol, scheduled_timeframe)
            for scheduled_timeframe in ("1d", "1h")
            for symbol in FEEDS
            if supports_scheduled_timeframe(symbol, scheduled_timeframe)
        ]
    raise ValueError("Unsupported ingestion command.")


def _argument_parser() -> StrictArgumentParser:
    parser = StrictArgumentParser(description="Ingest research-only market datasets.")
    parser.add_argument(
        "command", nargs="?", choices=("all", "hourly", "daily"), default="all"
    )
    parser.add_argument("--asset", choices=tuple(FEEDS))
    parser.add_argument("--timeframe", choices=("1h", "1d"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--env-file", default=".env.local")
    return parser


def provider_for_code(provider_code: str, max_pages: int, max_rows: int) -> Any:
    if provider_code == "binance-public":
        return FallbackMarketDataProvider(
            BinanceSpotAdapter(max_pages=max_pages, max_rows=max_rows),
            CcxtSpotAdapter(max_pages=max_pages, max_rows=max_rows),
        )
    if provider_code in {"vnstock-vci-free", "vnstock-kbs-free", "msn-via-vnstock"}:
        return VnstockAdapter(max_rows=max_rows)
    if provider_code == "dukascopy-public":
        return DukascopyXauAdapter(max_rows=max_rows)
    raise ValueError("Provider is not approved for market ingestion.")


def _provider_factory(max_pages: int, max_rows: int) -> Callable[[str], Any]:
    def create(asset: str) -> Any:
        return provider_for_code(FEEDS[asset].provider_code, max_pages, max_rows)

    return create


def _emit(outcomes: list[Any], exit_code: int) -> None:
    for outcome in outcomes:
        print(json.dumps(asdict(outcome), separators=(",", ":"), sort_keys=True))
    succeeded = sum(
        outcome.status in {"succeeded", "unchanged", "skipped"}
        for outcome in outcomes
    )
    summary = {
        "status": "succeeded" if exit_code == 0 else "partial_failure",
        "selected": len(outcomes),
        "succeeded": succeeded,
        "degraded": len(outcomes) - succeeded,
    }
    print(json.dumps(summary, separators=(",", ":")))


def _emit_fatal() -> None:
    print(
        json.dumps(
            {"status": "fatal", "errorCode": "configuration_error"},
            separators=(",", ":"),
        )
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    now: datetime | None = None,
    run_ingestion_fn: Callable[..., Any] = run_ingestion,
    provider_factory: object | None = None,
    connection_factory: Callable[..., Any] = psycopg.connect,
) -> int:
    try:
        args = _argument_parser().parse_args(argv)
        selections = build_selections(
            args.command,
            asset=args.asset,
            timeframe=args.timeframe,
        )
        max_pages = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_PAGES", default=128, minimum=1, maximum=512
        )
        max_rows = read_bounded_environment_integer(
            "MARKET_INGEST_MAX_ROWS",
            default=250_000,
            minimum=100,
            maximum=250_000,
        )
        providers = provider_factory or _provider_factory(max_pages, max_rows)
        scheduled_at = now or datetime.now(timezone.utc)

        if args.dry_run:
            outcomes, exit_code = run_ingestion_fn(
                selections,
                repository=None,
                provider_factory=providers,
                now=scheduled_at,
                dry_run=True,
            )
        else:
            database_url = load_database_url(Path(args.env_file))
            connection = connection_factory(
                psycopg_connection_url(database_url), autocommit=True
            )
            try:
                outcomes, exit_code = run_ingestion_fn(
                    selections,
                    repository=PostgresIngestionRepository(connection),
                    provider_factory=providers,
                    now=scheduled_at,
                    dry_run=False,
                )
            finally:
                connection.close()
        _emit(outcomes, exit_code)
        return int(exit_code)
    except (CliUsageError, ValueError):
        _emit_fatal()
        return 1
    except Exception:
        _emit_fatal()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
