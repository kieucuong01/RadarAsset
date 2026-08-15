from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Protocol
from zoneinfo import ZoneInfo

from smart_insights.refresh_repository import QueuedBriefingRefresh


class BriefingRefreshRepository(Protocol):
    def claim_next_request(self) -> QueuedBriefingRefresh | None: ...

    def complete_request(self, request: QueuedBriefingRefresh) -> None: ...

    def retry_or_fail(self, request: QueuedBriefingRefresh, code: str) -> None: ...


def process_next_briefing_refresh(
    repository: BriefingRefreshRepository,
    *,
    generate: Callable[..., object],
    now: datetime | None = None,
    timezone_name: str = "Asia/Bangkok",
) -> dict[str, str]:
    request = repository.claim_next_request()
    if request is None:
        return {"status": "idle"}

    as_of = now or datetime.now(timezone.utc)
    try:
        generate(
            organization_id=request.organization_id,
            user_id=request.user_id,
            local_date=as_of.astimezone(ZoneInfo(timezone_name)).date(),
            timezone_name=timezone_name,
            as_of=as_of,
        )
        repository.complete_request(request)
        return {"status": "succeeded", "id": request.id}
    except Exception:
        code = "BRIEFING_GENERATION_FAILED"
        repository.retry_or_fail(request, code)
        return {"status": "failed", "id": request.id, "code": code}
