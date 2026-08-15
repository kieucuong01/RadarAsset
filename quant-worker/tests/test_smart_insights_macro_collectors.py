from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

import collect_smart_insights
from collect_smart_insights import build_batch_collectors, run_live_smoke
from smart_insights.collectors import CollectionBatch
from smart_insights.collectors.cftc import CftcCollector
from smart_insights.collectors.fred import FredCollector
from smart_insights.contracts import RawSnapshot
from smart_insights.http import HttpResponse
from smart_insights.macro_registry import CFTC_MARKETS, FRED_SERIES


NOW = datetime(2026, 8, 13, 13, 0, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "macro"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class FakeTransport:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list[tuple[str, float, int]] = []

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        self.calls.append((url, timeout_seconds, max_bytes))
        return HttpResponse(
            status=200,
            headers={"Content-Type": "application/json"},
            body=self.payload.encode("utf-8"),
            url=url,
        )


def test_macro_registries_freeze_official_series_and_contracts() -> None:
    assert FRED_SERIES["DFII10"].metric_code == "macro.real_yield.10y_pct"
    assert FRED_SERIES["DFII10"].direction == -1
    assert FRED_SERIES["M2SL"].metric_code == "macro.m2_busd"
    assert FRED_SERIES["M2SL"].direction == 1
    assert set(FRED_SERIES) == {
        "DGS2", "DGS10", "DFII10", "DFF", "SOFR", "WALCL", "RRPONTSYD",
        "WTREGEN", "DTWEXBGS", "CPIAUCSL", "CPILFESL", "PCEPI", "PAYEMS",
        "UNRATE", "GDP", "M2SL",
    }
    assert CFTC_MARKETS["BTC"].contract_market_code == "133741"
    assert CFTC_MARKETS["USD_INDEX"].contract_market_code == "098662"
    assert CFTC_MARKETS["SP500_EMINI"].contract_market_code == "13874A"
    assert CFTC_MARKETS["NASDAQ100_MINI"].contract_market_code == "209742"
    assert CFTC_MARKETS["GOLD"].contract_market_code == "088691"
    assert CFTC_MARKETS["GOLD"].classification == "managed_money"


def test_fred_collects_allow_listed_observations_and_skips_missing_dot() -> None:
    transport = FakeTransport(fixture_text("fred-observations.json"))
    batch = FredCollector(
        transport=transport, api_key="test", clock=lambda: NOW
    ).collect(FRED_SERIES["DGS10"], date(2026, 8, 10), date(2026, 8, 13))

    assert batch.error_code is None
    assert [row.value for row in batch.observations] == [
        Decimal("4.25"), Decimal("4.30"), Decimal("4.32")
    ]
    assert batch.observations[-1].effective_at == datetime(
        2026, 8, 13, tzinfo=timezone.utc
    )
    assert batch.observations[-1].metric_code == "macro.yield.10y_pct"
    query = parse_qs(urlsplit(transport.calls[0][0]).query)
    assert query["series_id"] == ["DGS10"]
    assert query["file_type"] == ["json"]
    assert query["observation_start"] == ["2026-08-10"]
    assert batch.snapshot.source_url == (
        "https://api.stlouisfed.org/fred/series/observations"
    )
    assert "test" not in json.dumps(dict(batch.snapshot.metadata))


def test_fred_rejects_unknown_series_and_requires_key() -> None:
    with pytest.raises(ValueError, match="FRED_API_KEY"):
        FredCollector(transport=FakeTransport("{}"), api_key="")
    unknown = FRED_SERIES["DGS10"].__class__(
        series_id="EVIL", metric_code="macro.evil", name="Evil", unit="x",
        frequency="daily", direction=1,
    )
    with pytest.raises(ValueError, match="allow-listed"):
        FredCollector(
            transport=FakeTransport("{}"), api_key="test", clock=lambda: NOW
        ).collect(unknown, date(2026, 8, 10), date(2026, 8, 13))

    missing = run_live_smoke(
        "fred",
        as_of=NOW,
        batch_collectors={
            "fred": lambda _as_of: FredCollector(api_key="").collect(
                FRED_SERIES["DGS10"], date(2026, 8, 10), date(2026, 8, 13)
            )
        },
    )
    assert missing.error_code == "CONFIG_MISSING"


def test_fred_builder_backfills_enough_m2_history_without_expanding_other_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, date, date]] = []

    class RecordingFredCollector:
        def __init__(self, **kwargs: object) -> None:
            pass

        def collect(self, series, start: date, end: date) -> CollectionBatch:
            calls.append((series.series_id, start, end))
            source = collect_smart_insights.source_for_code("fred")
            return CollectionBatch(
                source,
                RawSnapshot(
                    content=b"{}",
                    content_type="application/json",
                    source_url=source.urls[0],
                    effective_at=None,
                    published_at=None,
                    observed_at=NOW,
                ),
                (),
            )

    monkeypatch.setattr(collect_smart_insights, "FredCollector", RecordingFredCollector)
    monkeypatch.setenv("SMART_INSIGHTS_FRED_OVERLAP_DAYS", "14")

    build_batch_collectors()["fred"](NOW)

    ranges = {series_id: (end - start).days for series_id, start, end in calls}
    assert ranges["M2SL"] >= 196
    assert ranges["DGS10"] == 14


@pytest.mark.parametrize(
    ("market_code", "expected_metric", "expected_net"),
    [
        ("BTC", "macro.cftc.btc_net_oi", Decimal("0.2")),
        ("USD_INDEX", "macro.cftc.usd_index_net_oi", Decimal("0.08")),
        ("SP500_EMINI", "macro.cftc.sp500_net_oi", Decimal("0.0666666667")),
        ("NASDAQ100_MINI", "macro.cftc.nasdaq100_net_oi", Decimal("0.15")),
    ],
)
def test_cftc_legacy_collects_futures_only_noncommercial_positions(
    market_code: str, expected_metric: str, expected_net: Decimal
) -> None:
    rows = json.loads(fixture_text("cftc-legacy.json"))
    market = CFTC_MARKETS[market_code]
    payload = json.dumps(
        [row for row in rows if row["cftc_contract_market_code"] == market.contract_market_code]
    )
    transport = FakeTransport(payload)
    batch = CftcCollector(transport=transport, clock=lambda: NOW).collect(
        market, report_date_from=date(2026, 7, 1)
    )

    assert batch.error_code is None
    ratio = next(row for row in batch.observations if row.metric_code == expected_metric)
    assert ratio.value.quantize(Decimal("0.0000000001")) == expected_net
    query = parse_qs(urlsplit(transport.calls[0][0]).query)
    assert query["$limit"] == ["5000"]
    assert "FutOnly" in query["$where"][0]
    assert market.contract_market_code in query["$where"][0]
    assert "noncomm_positions_long_all" in query["$select"][0]


def test_cftc_disaggregated_collects_gold_managed_money() -> None:
    market = CFTC_MARKETS["GOLD"]
    transport = FakeTransport(fixture_text("cftc-disaggregated.json"))
    batch = CftcCollector(transport=transport, clock=lambda: NOW).collect(
        market, report_date_from=date(2026, 7, 1)
    )

    ratio = next(
        row for row in batch.observations
        if row.metric_code == "gold.cftc.managed_money_net_oi"
    )
    assert ratio.value == Decimal("0.24")
    query = parse_qs(urlsplit(transport.calls[0][0]).query)
    assert "m_money_positions_long_all" in query["$select"][0]


def test_cftc_rejects_combined_rows_to_prevent_double_counting() -> None:
    rows = json.loads(fixture_text("cftc-legacy.json"))
    row = next(row for row in rows if row["cftc_contract_market_code"] == "133741")
    row["futonly_or_combined"] = "Combined"
    batch = CftcCollector(
        transport=FakeTransport(json.dumps([row])), clock=lambda: NOW
    ).collect(CFTC_MARKETS["BTC"], report_date_from=date(2026, 7, 1))

    assert batch.error_code == "UNEXPECTED_REPORT_TYPE"
    assert batch.observations == ()
