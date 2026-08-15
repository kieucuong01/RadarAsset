from datetime import datetime, timezone
from inspect import getsource
from typing import Any

from smart_insights.refresh_worker import (
    QueuedBriefingRefresh,
    process_next_briefing_refresh,
)
from smart_insights.refresh_repository import PostgresBriefingRefreshRepository


NOW = datetime(2026, 8, 15, 4, 30, tzinfo=timezone.utc)


class FakeRepository:
    def __init__(self, request: QueuedBriefingRefresh | None) -> None:
        self.request = request
        self.completed: list[str] = []
        self.retried: list[tuple[str, str]] = []

    def claim_next_request(self) -> QueuedBriefingRefresh | None:
        request, self.request = self.request, None
        return request

    def complete_request(self, request: QueuedBriefingRefresh) -> None:
        self.completed.append(request.id)

    def retry_or_fail(self, request: QueuedBriefingRefresh, code: str) -> None:
        self.retried.append((request.id, code))


def queued() -> QueuedBriefingRefresh:
    return QueuedBriefingRefresh(
        id="refresh-1",
        organization_id="org-1",
        user_id="user-1",
        processing_version=3,
        attempt_count=1,
    )


def test_worker_generates_local_daily_briefing_and_completes_request() -> None:
    repository = FakeRepository(queued())
    calls: list[dict[str, Any]] = []

    def generate(**kwargs: Any) -> object:
        calls.append(kwargs)
        return object()

    response = process_next_briefing_refresh(
        repository,
        generate=generate,
        now=NOW,
        timezone_name="Asia/Bangkok",
    )

    assert response == {"status": "succeeded", "id": "refresh-1"}
    assert repository.completed == ["refresh-1"]
    assert calls == [
        {
            "organization_id": "org-1",
            "user_id": "user-1",
            "local_date": NOW.astimezone().date(),
            "timezone_name": "Asia/Bangkok",
            "as_of": NOW,
        }
    ]


def test_worker_uses_requested_timezone_for_local_date() -> None:
    repository = FakeRepository(queued())
    calls: list[dict[str, Any]] = []

    process_next_briefing_refresh(
        repository,
        generate=lambda **kwargs: calls.append(kwargs),
        now=datetime(2026, 8, 15, 23, 30, tzinfo=timezone.utc),
        timezone_name="Asia/Bangkok",
    )

    assert calls[0]["local_date"].isoformat() == "2026-08-16"


def test_worker_retries_sanitized_failure_without_leaking_exception() -> None:
    repository = FakeRepository(queued())

    def fail(**_kwargs: Any) -> object:
        raise RuntimeError("DEEPSEEK_API_KEY=secret")

    response = process_next_briefing_refresh(repository, generate=fail, now=NOW)

    assert response == {
        "status": "failed",
        "id": "refresh-1",
        "code": "BRIEFING_GENERATION_FAILED",
    }
    assert repository.retried == [
        ("refresh-1", "BRIEFING_GENERATION_FAILED")
    ]


def test_worker_is_idle_without_pending_request() -> None:
    repository = FakeRepository(None)

    assert process_next_briefing_refresh(repository, generate=lambda **_kwargs: None) == {
        "status": "idle"
    }


def test_repository_reclaims_a_stale_running_request_after_worker_exit() -> None:
    source = getsource(PostgresBriefingRefreshRepository.claim_next_request)

    assert "status = 'running'" in source
    assert "started_at <= NOW() - make_interval" in source
