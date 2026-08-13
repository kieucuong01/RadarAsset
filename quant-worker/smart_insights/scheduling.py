from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from .collectors.cryptocraft import CalendarEventInput


@dataclass(frozen=True, slots=True)
class ScheduledSourceJob:
    job_code: str
    target: str


def _is_due(
    job_code: str,
    *,
    now: datetime,
    last_success: Mapping[str, datetime],
    cadence: timedelta,
) -> bool:
    completed_at = last_success.get(job_code)
    if completed_at is None:
        return True
    if completed_at.tzinfo is None or completed_at.utcoffset() is None:
        raise ValueError("Calendar job timestamps must be timezone-aware.")
    return now - completed_at >= cadence


def due_calendar_jobs(
    now: datetime,
    *,
    events: Sequence[CalendarEventInput],
    last_success: Mapping[str, datetime],
) -> tuple[ScheduledSourceJob, ...]:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Calendar schedule time must be timezone-aware.")
    jobs: list[ScheduledSourceJob] = []
    if _is_due(
        "cryptocraft-current",
        now=now,
        last_success=last_success,
        cadence=timedelta(hours=2),
    ):
        jobs.append(ScheduledSourceJob("cryptocraft-current", "current"))
    if _is_due(
        "cryptocraft-next",
        now=now,
        last_success=last_success,
        cadence=timedelta(hours=12),
    ):
        jobs.append(ScheduledSourceJob("cryptocraft-next", "next"))

    seen_event_jobs: set[str] = set()
    timed = sorted(
        (
            event
            for event in events
            if event.impact == "high"
            and event.time_status == "timed"
            and event.event_at_utc is not None
            and event.detail_url is not None
        ),
        key=lambda event: (event.event_at_utc, event.source_event_key),
    )
    for event in timed:
        assert event.event_at_utc is not None
        window_start = event.event_at_utc - timedelta(minutes=30)
        window_end = event.event_at_utc + timedelta(minutes=90)
        if not window_start <= now <= window_end:
            continue
        job_code = f"cryptocraft-event:{event.source_event_key}"
        if job_code in seen_event_jobs:
            continue
        seen_event_jobs.add(job_code)
        if _is_due(
            job_code,
            now=now,
            last_success=last_success,
            cadence=timedelta(minutes=15),
        ):
            jobs.append(ScheduledSourceJob(job_code, event.detail_url or ""))
    return tuple(jobs)
