from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import json
from pathlib import Path

import pytest

from fx_rates.repository import PostgresFxRateRepository
from fx_rates.vietcombank import (
    FxObservation,
    FxSchemaDrift,
    backfill_window,
    parse_vietcombank_response,
)


FIXTURE = Path(__file__).parent / "fixtures" / "fx" / "vietcombank-usd-vnd.json"


def fixture_payload() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parser_extracts_provider_date_and_usd_midpoint() -> None:
    fetched_at = datetime(2026, 8, 16, 1, 0, tzinfo=timezone.utc)

    row = parse_vietcombank_response(
        fixture_payload(),
        requested_date=date(2026, 8, 15),
        fetched_at=fetched_at,
    )

    assert row == FxObservation(
        effective_date=date(2026, 8, 15),
        transfer_buy=Decimal("25950.00"),
        sell=Decimal("26330.00"),
        mid=Decimal("26140.00"),
        source="vietcombank",
        fetched_at=fetched_at,
    )


def test_parser_rejects_missing_usd_non_positive_rate_and_wrong_date() -> None:
    missing = fixture_payload() | {"Data": []}
    with pytest.raises(FxSchemaDrift, match="USD_RATE_MISSING"):
        parse_vietcombank_response(missing, requested_date=date(2026, 8, 15))

    invalid = fixture_payload()
    invalid["Data"][0]["transfer"] = "0.00"  # type: ignore[index]
    with pytest.raises(FxSchemaDrift, match="USD_RATE_INVALID"):
        parse_vietcombank_response(invalid, requested_date=date(2026, 8, 15))

    future = fixture_payload() | {"Date": "2026-08-16T00:00:00"}
    with pytest.raises(FxSchemaDrift, match="PROVIDER_DATE_AFTER_REQUEST"):
        parse_vietcombank_response(future, requested_date=date(2026, 8, 15))


def test_backfill_window_is_exactly_ten_years_and_inclusive() -> None:
    start, end = backfill_window(date(2026, 8, 17))

    assert start == date(2016, 8, 17)
    assert end == date(2026, 8, 17)


class RecordingCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        self.calls.append((sql, params))


class RecordingConnection:
    def __init__(self) -> None:
        self.cursor_instance = RecordingCursor()

    def cursor(self) -> RecordingCursor:
        return self.cursor_instance


def test_repository_upserts_one_immutable_effective_date_without_fallback_data() -> None:
    connection = RecordingConnection()
    observation = parse_vietcombank_response(
        fixture_payload(),
        requested_date=date(2026, 8, 15),
    )

    PostgresFxRateRepository(connection).upsert(observation)

    [(sql, params)] = connection.cursor_instance.calls
    assert "INSERT INTO fx_rates" in sql
    assert "ON CONFLICT (base_currency, quote_currency, effective_date, source)" in sql
    assert params[0:4] == ("USD", "VND", date(2026, 8, 15), Decimal("25950.00"))
    assert Decimal("26000") not in params
