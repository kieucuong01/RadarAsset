from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from backtest.models import Bar
from backtest.providers import ProviderUnavailableError
from backtest.publication import PublicationResult
from process_ingestion_requests import (
    QueuedIngestionRequest,
    process_next_ingestion_request,
)


NOW = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)


def request(provider_code: str = "binance-public") -> QueuedIngestionRequest:
    return QueuedIngestionRequest(
        id="request-1",
        provider_code=provider_code,
        provider_name="Binance Public Spot",
        terms_url="https://developers.binance.com",
        provider_symbol="ETHUSDT",
        asset="ETH",
        asset_name="Ethereum",
        market="crypto_spot",
        venue="BINANCE",
        currency="USDT",
        timezone_name="UTC",
        canonical_key="CRYPTO:BINANCE:ETHUSDT",
        maximum_leverage=Decimal("1"),
        timeframe="1h",
        worker_id="worker-a",
        attempt_count=1,
    )


def bars() -> list[Bar]:
    return [
        Bar(
            asset="ETH",
            timestamp=datetime(2026, 8, 11, 10, tzinfo=timezone.utc),
            timeframe="1h",
            open=Decimal("100"),
            high=Decimal("101"),
            low=Decimal("99"),
            close=Decimal("100"),
            volume=Decimal("10"),
            source="binance-public-spot",
        )
    ]


class FakeProvider:
    def __init__(self, result: list[Bar] | Exception) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def fetch(self, **kwargs: Any) -> list[Bar]:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeRequestRepository:
    def __init__(self, queued: QueuedIngestionRequest | None) -> None:
        self.queued = queued
        self.claim_count = 0
        self.completed: tuple[str, str] | None = None
        self.failed: tuple[str, str] | None = None
        self.retried: tuple[str, str] | None = None
        self.prepared = None

    def claim_next_request(self) -> QueuedIngestionRequest | None:
        self.claim_count += 1
        queued, self.queued = self.queued, None
        return queued

    def load_active(self, _request: QueuedIngestionRequest):
        return None

    def publish(self, _request: QueuedIngestionRequest, prepared: Any) -> PublicationResult:
        self.prepared = prepared
        return PublicationResult(
            status="succeeded",
            dataset_version_id="eth-1h-version",
            version=1,
            checksum=prepared.checksum,
            row_count=prepared.row_count,
            missing_bar_count=prepared.missing_bar_count,
            quality_status=prepared.quality_status,
        )

    def complete_request(self, queued: QueuedIngestionRequest, dataset_version_id: str) -> None:
        self.completed = (queued.id, dataset_version_id)

    def retry_or_fail(self, queued: QueuedIngestionRequest, code: str) -> None:
        self.retried = (queued.id, code)

    def fail_request(self, queued: QueuedIngestionRequest, code: str) -> None:
        self.failed = (queued.id, code)


def test_request_worker_claims_once_and_publishes_dataset() -> None:
    repository = FakeRequestRepository(request())
    provider = FakeProvider(bars())

    response = process_next_ingestion_request(
        repository, lambda _code: provider, now=NOW
    )

    assert response == {
        "status": "succeeded",
        "id": "request-1",
        "datasetVersionId": "eth-1h-version",
    }
    assert repository.completed == ("request-1", "eth-1h-version")
    assert repository.claim_count == 1
    assert repository.prepared.asset == "ETH"
    assert provider.calls[0]["symbol"] == "ETHUSDT"


def test_request_worker_rejects_unapproved_provider() -> None:
    repository = FakeRequestRepository(request("user-url"))

    response = process_next_ingestion_request(repository, lambda _code: FakeProvider(bars()), now=NOW)

    assert response["code"] == "PROVIDER_NOT_APPROVED"
    assert repository.failed == ("request-1", "PROVIDER_NOT_APPROVED")


def test_request_worker_retries_sanitized_provider_failures() -> None:
    repository = FakeRequestRepository(request())
    provider = FakeProvider(ProviderUnavailableError("rate_limited", "token=secret"))

    response = process_next_ingestion_request(repository, lambda _code: provider, now=NOW)

    assert response == {"status": "failed", "id": "request-1", "code": "PROVIDER_UNAVAILABLE"}
    assert repository.retried == ("request-1", "PROVIDER_UNAVAILABLE")


def test_request_worker_is_idle_without_queue_work() -> None:
    repository = FakeRequestRepository(None)
    assert process_next_ingestion_request(repository, lambda _code: FakeProvider(bars()), now=NOW) == {
        "status": "idle"
    }
