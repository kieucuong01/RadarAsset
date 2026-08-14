from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import importlib
import json
from pathlib import Path

from smart_insights.http import HttpResponse


NOW = datetime(2026, 8, 14, 9, 30, tzinfo=timezone.utc)
TRACKED = "bc1q0000000000000000000000000000000000001"
EXCHANGE = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "crypto"


class RoutingTransport:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        self.calls.append(url)
        if url.endswith("/api/blocks/tip/height"):
            body = b"1000"
        elif url.endswith(f"/api/address/{TRACKED}"):
            body = (FIXTURES / "mempool-large-address-summary.json").read_bytes()
        elif url.endswith(f"/api/address/{TRACKED}/txs"):
            body = (FIXTURES / "mempool-large-address-transactions.json").read_bytes()
        else:
            raise AssertionError(f"Unexpected URL: {url}")
        return HttpResponse(200, {"Content-Type": "application/json"}, body, url)


class PartialTransport(RoutingTransport):
    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        if "bc1q1111111111111111111111111111111111111" in url:
            return HttpResponse(503, {"Content-Type": "application/json"}, b"{}", url)
        return super().fetch(
            url, timeout_seconds=timeout_seconds, max_bytes=max_bytes
        )


class PaginatedTransport(RoutingTransport):
    def __init__(self) -> None:
        super().__init__()
        self.first_page = [
            {
                "txid": f"{index + 1:064x}",
                "vin": [],
                "vout": [],
                "status": {
                    "confirmed": True,
                    "block_height": 994,
                    "block_time": 1786590000 + index,
                },
            }
            for index in range(25)
        ]

    def fetch(
        self, url: str, *, timeout_seconds: float, max_bytes: int
    ) -> HttpResponse:
        if url.endswith(f"/api/address/{TRACKED}/txs"):
            self.calls.append(url)
            return HttpResponse(
                200,
                {"Content-Type": "application/json"},
                json.dumps(self.first_page).encode("utf-8"),
                url,
            )
        if f"/api/address/{TRACKED}/txs/chain/" in url:
            self.calls.append(url)
            old_page = [
                {
                    "txid": "f" * 64,
                    "vin": [],
                    "vout": [],
                    "status": {
                        "confirmed": True,
                        "block_height": 990,
                        "block_time": 1786500000,
                    },
                }
            ]
            return HttpResponse(
                200,
                {"Content-Type": "application/json"},
                json.dumps(old_page).encode("utf-8"),
                url,
            )
        return super().fetch(
            url, timeout_seconds=timeout_seconds, max_bytes=max_bytes
        )


def metric(batch: object, code: str, **dimensions: str) -> object:
    rows = [
        row
        for row in batch.observations
        if row.metric_code == code
        and all(row.dimensions.get(key) == value for key, value in dimensions.items())
    ]
    assert len(rows) == 1
    return rows[0]


def test_collects_confirmed_balance_and_direct_reviewed_exchange_flows() -> None:
    labels_module = importlib.import_module("smart_insights.exchange_labels")
    collector_module = importlib.import_module(
        "smart_insights.collectors.mempool_large_addresses"
    )
    label = labels_module.ExchangeLabel(
        address=EXCHANGE,
        entity_name="Test Exchange",
        entity_type="exchange",
        source_url="https://example.com/exchange-proof",
        reviewed_at=date(2026, 8, 1),
        registry_version="test-v1",
        confidence="reviewed",
    )
    watch = collector_module.AddressWatch(
        address=TRACKED,
        rank=2,
        discovery_balance_btc=Decimal("1200"),
        label_status="unknown",
        cohort_version="cohort-v1",
    )

    batch = collector_module.MempoolLargeAddressCollector(
        transport=RoutingTransport(), labels={EXCHANGE: label}
    ).collect(
        NOW,
        watchlist=(watch,),
        previous_cutoff=datetime(2026, 8, 13, tzinfo=timezone.utc),
        balance_history={},
        last_outgoing={},
    )

    assert batch.error_code is None
    assert metric(
        batch, "crypto.large_address.confirmed_balance_btc", address=TRACKED
    ).value == Decimal("1200")
    assert metric(batch, "crypto.large_address.to_exchange_btc").value == Decimal(
        "25"
    )
    assert metric(batch, "crypto.large_address.from_exchange_btc").value == Decimal(
        "10"
    )
    assert metric(
        batch, "crypto.large_address.exchange_flow_pressure_btc"
    ).value == Decimal("15")
    assert metric(batch, "crypto.large_address.flow_label_coverage").value == Decimal(
        "0.875000"
    )
    assert metric(batch, "crypto.large_address.address_coverage").value == Decimal(
        "1.000000"
    )
    assert metric(batch, "crypto.large_address.transaction_coverage").value == Decimal(
        "1.000000"
    )
    assert all(
        row.dimensions.get("txid")
        != "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        for row in batch.observations
    )


def test_partial_address_failure_is_published_with_explicit_coverage_flag() -> None:
    collector_module = importlib.import_module(
        "smart_insights.collectors.mempool_large_addresses"
    )
    watches = (
        collector_module.AddressWatch(
            TRACKED, 2, Decimal("1200"), "unknown", "cohort-v1"
        ),
        collector_module.AddressWatch(
            "bc1q1111111111111111111111111111111111111",
            3,
            Decimal("1100"),
            "unknown",
            "cohort-v1",
        ),
    )

    batch = collector_module.MempoolLargeAddressCollector(
        transport=PartialTransport(), labels={}
    ).collect(
        NOW,
        watchlist=watches,
        previous_cutoff=datetime(2026, 8, 13, tzinfo=timezone.utc),
        balance_history={},
        last_outgoing={},
    )

    assert batch.error_code is None
    assert metric(batch, "crypto.large_address.address_coverage").value == Decimal(
        "0.500000"
    )
    assert metric(
        batch, "crypto.large_address.transaction_coverage"
    ).value == Decimal("0.500000")
    assert all(
        "PARTIAL_ADDRESS_COVERAGE" in row.quality_flags
        for row in batch.observations
    )


def test_transaction_history_paginates_until_the_previous_cutoff() -> None:
    collector_module = importlib.import_module(
        "smart_insights.collectors.mempool_large_addresses"
    )
    transport = PaginatedTransport()
    watch = collector_module.AddressWatch(
        TRACKED, 2, Decimal("1200"), "unknown", "cohort-v1"
    )

    batch = collector_module.MempoolLargeAddressCollector(
        transport=transport, labels={}
    ).collect(
        NOW,
        watchlist=(watch,),
        previous_cutoff=datetime(2026, 8, 13, tzinfo=timezone.utc),
        balance_history={},
        last_outgoing={},
    )

    assert batch.error_code is None
    assert len(
        [url for url in transport.calls if f"/api/address/{TRACKED}/txs/chain/" in url]
    ) == 1
    assert all(row.dimensions.get("txid") != "f" * 64 for row in batch.observations)


def test_reviewed_exchange_flow_marks_eligible_dormant_activation() -> None:
    labels_module = importlib.import_module("smart_insights.exchange_labels")
    collector_module = importlib.import_module(
        "smart_insights.collectors.mempool_large_addresses"
    )
    label = labels_module.ExchangeLabel(
        EXCHANGE,
        "Test Exchange",
        "exchange",
        "https://example.com/exchange-proof",
        date(2026, 8, 1),
        "test-v1",
        "reviewed",
    )
    watch = collector_module.AddressWatch(
        TRACKED, 2, Decimal("1200"), "unknown", "cohort-v1"
    )

    batch = collector_module.MempoolLargeAddressCollector(
        transport=RoutingTransport(), labels={EXCHANGE: label}
    ).collect(
        NOW,
        watchlist=(watch,),
        previous_cutoff=datetime(2026, 8, 13, tzinfo=timezone.utc),
        balance_history={},
        last_outgoing={TRACKED: NOW - timedelta(days=182)},
    )

    assert metric(
        batch, "crypto.large_address.dormant_to_exchange_btc"
    ).value == Decimal("25")
    assert metric(
        batch, "crypto.large_address.dormant_from_exchange_btc"
    ).value == Decimal("10")
