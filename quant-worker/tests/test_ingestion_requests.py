from datetime import datetime, timezone
from decimal import Decimal
import time
from typing import Any

import pytest

from backtest.models import Bar
from backtest.providers import ProviderUnavailableError
from backtest.publication import PublicationResult
from process_ingestion_requests import (
    QueuedIngestionRequest,
    process_ingestion_backlog,
    process_next_ingestion_request,
    requeue_failed_requests,
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
    def __init__(self, queued: QueuedIngestionRequest | list[QueuedIngestionRequest] | None) -> None:
        self.queue = queued if isinstance(queued, list) else ([] if queued is None else [queued])
        self.claim_count = 0
        self.completed: list[tuple[str, str]] = []
        self.failed: tuple[str, str] | None = None
        self.retried: tuple[str, str] | None = None
        self.prepared = None
        self.requeued: tuple[int, str | None, str | None] | None = None
        self.swept = 0
        self.heartbeats: list[str | None] = []
        self.renewals: list[str] = []
        self.renew_result = True
        self.lease_heartbeat_interval_seconds = 0.01

    def claim_next_request(self) -> QueuedIngestionRequest | None:
        self.claim_count += 1
        return self.queue.pop(0) if self.queue else None

    def fail_exhausted_requests(self) -> int:
        self.swept += 1
        return 0

    def heartbeat(self, current_request_id: str | None = None) -> None:
        self.heartbeats.append(current_request_id)

    def renew_lease(self, queued: QueuedIngestionRequest) -> bool:
        self.renewals.append(queued.id)
        return self.renew_result

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
        self.completed.append((queued.id, dataset_version_id))

    def retry_or_fail(self, queued: QueuedIngestionRequest, code: str) -> None:
        self.retried = (queued.id, code)

    def fail_request(self, queued: QueuedIngestionRequest, code: str) -> None:
        self.failed = (queued.id, code)

    def requeue_failed_requests(
        self, *, limit: int, error_code: str | None, provider_code: str | None
    ) -> int:
        self.requeued = (limit, error_code, provider_code)
        return min(limit, 7)


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
    assert repository.completed == [("request-1", "eth-1h-version")]
    assert repository.claim_count == 1
    assert repository.prepared.asset == "ETH"
    assert provider.calls[0]["symbol"] == "ETHUSDT"
    assert repository.heartbeats[0] == "request-1"
    assert repository.heartbeats[-1] is None


def test_request_worker_renews_the_lease_during_slow_provider_io() -> None:
    class SlowProvider(FakeProvider):
        def fetch(self, **kwargs: Any) -> list[Bar]:
            time.sleep(0.04)
            return super().fetch(**kwargs)

    repository = FakeRequestRepository(request())

    response = process_next_ingestion_request(
        repository, lambda _code: SlowProvider(bars()), now=NOW
    )

    assert response["status"] == "succeeded"
    assert repository.renewals


def test_request_worker_does_not_publish_after_losing_its_lease() -> None:
    class SlowProvider(FakeProvider):
        def fetch(self, **kwargs: Any) -> list[Bar]:
            time.sleep(0.04)
            return super().fetch(**kwargs)

    repository = FakeRequestRepository(request())
    repository.renew_result = False

    response = process_next_ingestion_request(
        repository, lambda _code: SlowProvider(bars()), now=NOW
    )

    assert response == {"status": "failed", "id": "request-1", "code": "worker_lost"}
    assert repository.prepared is None


def test_request_worker_records_ccxt_fallback_provenance() -> None:
    repository = FakeRequestRepository(request())
    fallback_rows = bars()
    fallback_rows[0] = Bar(
        **{**fallback_rows[0].__dict__, "source": "ccxt:kraken"}
    )

    process_next_ingestion_request(
        repository, lambda _code: FakeProvider(fallback_rows), now=NOW
    )

    assert repository.prepared.source_metadata["fallbackProvider"] == "ccxt:kraken"


def test_request_worker_rejects_unapproved_provider() -> None:
    repository = FakeRequestRepository(request("user-url"))

    response = process_next_ingestion_request(repository, lambda _code: FakeProvider(bars()), now=NOW)

    assert response["code"] == "PROVIDER_NOT_APPROVED"
    assert repository.failed == ("request-1", "PROVIDER_NOT_APPROVED")


def test_request_worker_retries_sanitized_provider_failures() -> None:
    repository = FakeRequestRepository(request())
    provider = FakeProvider(ProviderUnavailableError("rate_limited", "token=secret"))

    response = process_next_ingestion_request(repository, lambda _code: provider, now=NOW)

    assert response == {"status": "failed", "id": "request-1", "code": "rate_limited"}
    assert repository.retried == ("request-1", "rate_limited")


def test_request_worker_is_idle_without_queue_work() -> None:
    repository = FakeRequestRepository(None)
    assert process_next_ingestion_request(repository, lambda _code: FakeProvider(bars()), now=NOW) == {
        "status": "idle"
    }


def test_requeue_failed_requests_is_bounded_and_keeps_attempt_history() -> None:
    repository = FakeRequestRepository(None)

    count = requeue_failed_requests(
        repository,
        limit=20,
        error_code="network_error",
        provider_code="vnstock-vci-free",
    )

    assert count == 7
    assert repository.requeued == (20, "network_error", "vnstock-vci-free")


def test_requeue_repository_skips_duplicate_active_requests() -> None:
    import inspect

    from backtest.ingestion_repository import PostgresRequestRepository

    source = inspect.getsource(PostgresRequestRepository.requeue_failed_requests)

    assert "active_request" in source
    assert "NOT EXISTS" in source
    assert "DISTINCT ON" in source
    assert "dataset_versions" in source
    assert "version.is_active" in source


def test_drain_processes_until_idle_without_sleeping() -> None:
    first = request()
    second = QueuedIngestionRequest(**{**request().__dict__, "id": "request-2"})
    repository = FakeRequestRepository([first, second])

    result = process_ingestion_backlog(
        repository,
        lambda _code: FakeProvider(bars()),
        batch_limit=1,
        drain=True,
        max_total=10,
        sleep=lambda _seconds: None,
        poll_seconds=0.01,
        now=NOW,
    )

    assert result == {"status": "succeeded", "processed": 2, "failed": 0}
    assert repository.completed == [
        ("request-1", "eth-1h-version"),
        ("request-2", "eth-1h-version"),
    ]
    assert repository.claim_count == 3
    assert repository.swept == 1


def test_one_provider_failure_does_not_block_the_next_request() -> None:
    failed = request()
    succeeded = QueuedIngestionRequest(
        **{**request().__dict__, "id": "request-2", "provider_code": "vnstock-vci-free"}
    )
    repository = FakeRequestRepository([failed, succeeded])

    def provider_factory(code: str) -> FakeProvider:
        if code == "binance-public":
            return FakeProvider(ProviderUnavailableError("rate_limited", "bounded"))
        return FakeProvider(bars())

    result = process_ingestion_backlog(
        repository,
        provider_factory,
        batch_limit=2,
        drain=False,
        max_total=2,
        sleep=lambda _seconds: None,
        now=NOW,
    )

    assert result == {"status": "partial_failure", "processed": 2, "failed": 1}
    assert repository.completed == [("request-2", "eth-1h-version")]


def test_request_repository_sweeps_expired_exhausted_leases() -> None:
    import inspect

    from backtest.ingestion_repository import PostgresRequestRepository

    source = inspect.getsource(PostgresRequestRepository.fail_exhausted_requests)

    assert "status = 'running'" in source
    assert "lease_expires_at <= NOW()" in source
    assert "attempt_count >= 3" in source
    assert "status = 'failed'" in source
    assert "worker_lost" in source


def test_drain_stops_at_max_total_guard() -> None:
    requests = [
        QueuedIngestionRequest(**{**request().__dict__, "id": f"request-{index}"})
        for index in range(3)
    ]
    repository = FakeRequestRepository(requests)

    result = process_ingestion_backlog(
        repository,
        lambda _code: FakeProvider(bars()),
        batch_limit=2,
        drain=True,
        max_total=2,
        sleep=lambda _seconds: None,
        poll_seconds=0.01,
        now=NOW,
    )

    assert result == {"status": "succeeded", "processed": 2, "failed": 0}
    assert len(repository.completed) == 2


def test_drain_throttles_between_completed_provider_requests() -> None:
    first = request()
    second = QueuedIngestionRequest(**{**request().__dict__, "id": "request-2"})
    repository = FakeRequestRepository([first, second])
    sleeps: list[float] = []

    process_ingestion_backlog(
        repository,
        lambda _code: FakeProvider(bars()),
        batch_limit=2,
        drain=True,
        max_total=2,
        sleep=sleeps.append,
        poll_seconds=0.01,
        request_delay_seconds=1.0,
        now=NOW,
    )

    assert sleeps == [1.0]


def test_watch_waits_when_queue_is_empty_instead_of_exiting() -> None:
    repository = FakeRequestRepository(None)

    def stop_after_poll(_seconds: float) -> None:
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        process_ingestion_backlog(
            repository,
            lambda _code: FakeProvider(bars()),
            batch_limit=1,
            drain=False,
            watch=True,
            max_total=1,
            sleep=stop_after_poll,
            poll_seconds=0.01,
            now=NOW,
        )

    assert repository.claim_count == 1
    assert repository.heartbeats == [None]
