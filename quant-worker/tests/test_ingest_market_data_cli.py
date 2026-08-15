from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from backtest.catalog import FEEDS
from backtest.ingestion import IngestionOutcome
from ingest_market_data import (
    build_selections,
    load_database_url,
    main,
    psycopg_connection_url,
    read_bounded_environment_integer,
)


NOW = datetime(2026, 8, 10, 12, tzinfo=timezone.utc)


def test_build_selections_maps_scheduler_commands_to_the_allowlist() -> None:
    hourly = build_selections("hourly", asset=None, timeframe=None)
    daily = build_selections("daily", asset=None, timeframe=None)
    all_selections = build_selections("all", asset=None, timeframe=None)
    hourly_symbols = [symbol for symbol in FEEDS if symbol not in {"VNINDEX", "VN30"}]

    assert [(item.asset, item.timeframe) for item in hourly] == [
        (symbol, "1h") for symbol in hourly_symbols
    ]
    assert [(item.asset, item.timeframe) for item in daily] == [
        (symbol, "1d") for symbol in FEEDS
    ]
    assert [(item.asset, item.timeframe) for item in all_selections] == [
        *[(symbol, "1d") for symbol in FEEDS],
        *[(symbol, "1h") for symbol in hourly_symbols],
    ]


def test_main_returns_one_for_an_incomplete_single_feed_selection(capsys: Any) -> None:
    exit_code = main(["all", "--asset", "BTC", "--dry-run"], now=NOW)

    assert exit_code == 1
    assert json.loads(capsys.readouterr().out) == {
        "status": "fatal",
        "errorCode": "configuration_error",
    }


def test_dry_run_emits_sanitized_json_and_propagates_partial_exit(capsys: Any) -> None:
    captured: list[Any] = []

    def fake_run(selections: list[Any], **kwargs: Any):
        captured.extend(selections)
        return (
            [
                IngestionOutcome(
                    asset=item.asset,
                    timeframe=item.timeframe,
                    status="unavailable" if item.asset == "FPT" else "succeeded",
                    fetched_row_count=0 if item.asset == "FPT" else 10,
                    error_code="provider_unavailable" if item.asset == "FPT" else None,
                )
                for item in selections
            ],
            2,
        )

    exit_code = main(
        ["hourly", "--dry-run"],
        now=NOW,
        run_ingestion_fn=fake_run,
        provider_factory=object(),
    )

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    hourly_symbols = [symbol for symbol in FEEDS if symbol not in {"VNINDEX", "VN30"}]
    assert exit_code == 2
    assert [(item.asset, item.timeframe) for item in captured] == [
        (symbol, "1h") for symbol in hourly_symbols
    ]
    assert lines[-1] == {
        "status": "partial_failure",
        "selected": len(hourly_symbols),
        "succeeded": len(hourly_symbols) - 1,
        "degraded": 1,
    }
    assert "errorMessage" not in lines[0]


def test_env_file_loader_reads_only_database_url_without_expansion(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    env_file = tmp_path / f".qa-env-{uuid4().hex}.local"
    try:
        env_file.write_text(
            'DATABASE_URL="postgresql://user:pass@localhost:5432/qa"\n'
            "IGNORED_SECRET=do-not-load\n",
            encoding="utf-8",
        )
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("IGNORED_SECRET", raising=False)

        assert load_database_url(env_file) == "postgresql://user:pass@localhost:5432/qa"
        assert os.environ["DATABASE_URL"] == "postgresql://user:pass@localhost:5432/qa"
        assert "IGNORED_SECRET" not in os.environ
    finally:
        env_file.unlink(missing_ok=True)


def test_bounded_integer_rejects_values_outside_the_code_owned_range(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("MARKET_INGEST_MAX_PAGES", "999")

    try:
        read_bounded_environment_integer(
            "MARKET_INGEST_MAX_PAGES", default=128, minimum=1, maximum=512
        )
    except ValueError as error:
        assert str(error) == "MARKET_INGEST_MAX_PAGES is outside the supported range."
    else:
        raise AssertionError("Expected the out-of-range limit to be rejected.")


def test_psycopg_connection_url_removes_the_prisma_public_schema_parameter() -> None:
    assert psycopg_connection_url(
        "postgresql://user:pass@localhost:5432/qa?schema=public&sslmode=disable"
    ) == "postgresql://user:pass@localhost:5432/qa?sslmode=disable"


def test_psycopg_connection_url_rejects_a_non_public_prisma_schema() -> None:
    with pytest.raises(ValueError, match="Only the public database schema is supported"):
        psycopg_connection_url(
            "postgresql://user:pass@localhost:5432/qa?schema=private"
        )
