from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path

from smart_insights.contracts import SourceDefinition, SourceRunResult
from smart_insights.http import SourceFetchError
from smart_insights.sources import SOURCE_CODES, source_for_code
from smart_insights.validation import ObservationValidationError


SCHEDULES = (
    "daily",
    "weekly",
    "monthly",
    "calendar-current",
    "calendar-next",
    "calendar-event",
)
_SOURCE_SCHEDULE = {
    "daily": "daily",
    "weekly": "weekly",
    "monthly": "source_period",
    "calendar-current": "calendar",
    "calendar-next": "calendar",
    "calendar-event": "calendar",
}


@dataclass(frozen=True, slots=True)
class CollectionOutcome:
    source_code: str
    status: str
    records_fetched: int
    error_code: str | None


Collector = Callable[[SourceDefinition], SourceRunResult]


def select_sources(
    schedule: str,
    *,
    source_code: str | None = None,
    include_disabled: bool = False,
) -> tuple[SourceDefinition, ...]:
    source_schedule = _SOURCE_SCHEDULE.get(schedule)
    if source_schedule is None:
        raise ValueError("Schedule is not supported.")
    if source_code is not None:
        if "://" in source_code:
            raise ValueError("Source must be a registered code.")
        try:
            source = source_for_code(source_code)
        except KeyError as error:
            raise ValueError("Source must be a registered code.") from error
        if source.schedule != source_schedule:
            raise ValueError("Source is not configured for this schedule.")
        return (source,)
    return tuple(
        source
        for source in (source_for_code(code) for code in SOURCE_CODES)
        if (include_disabled or source.enabled) and source.schedule == source_schedule
    )


def run_collection(
    schedule: str,
    *,
    source_code: str | None,
    dry_run: bool,
    collectors: Mapping[str, Collector],
) -> tuple[list[CollectionOutcome], int]:
    sources = select_sources(
        schedule, source_code=source_code, include_disabled=dry_run
    )
    if not sources:
        return [], 2
    outcomes: list[CollectionOutcome] = []
    for source in sources:
        if dry_run:
            outcomes.append(CollectionOutcome(source.code, "dry_run", 0, None))
            continue
        collector = collectors.get(source.code)
        if collector is None:
            outcomes.append(
                CollectionOutcome(source.code, "failed", 0, "SOURCE_NOT_IMPLEMENTED")
            )
            continue
        try:
            result = collector(source)
            outcomes.append(
                CollectionOutcome(
                    source.code,
                    result.status,
                    result.records_fetched,
                    result.error_code,
                )
            )
        except (SourceFetchError, ObservationValidationError) as error:
            outcomes.append(CollectionOutcome(source.code, "failed", 0, error.code))
        except Exception:
            outcomes.append(CollectionOutcome(source.code, "failed", 0, "INTERNAL_ERROR"))
    succeeded = {"succeeded", "unchanged", "dry_run"}
    return outcomes, 0 if all(outcome.status in succeeded for outcome in outcomes) else 1


def load_environment(env_file: Path) -> None:
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if not name or not name.replace("_", "").isalnum() or name[0].isdigit():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if "\n" not in value and "\r" not in value:
            os.environ.setdefault(name, value)


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect registered Smart Insights sources.")
    parser.add_argument("schedule", choices=SCHEDULES)
    parser.add_argument("--source")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--env-file", default=".env.local")
    return parser


def _emit(outcomes: Sequence[CollectionOutcome], exit_code: int) -> None:
    for outcome in outcomes:
        print(json.dumps(asdict(outcome), separators=(",", ":"), sort_keys=True))
    print(
        json.dumps(
            {
                "failed": sum(outcome.status == "failed" for outcome in outcomes),
                "selected": len(outcomes),
                "status": "ok" if exit_code == 0 else "error",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    collectors: Mapping[str, Collector] | None = None,
) -> int:
    args = _argument_parser().parse_args(argv)
    load_environment(Path(args.env_file))
    try:
        outcomes, exit_code = run_collection(
            args.schedule,
            source_code=args.source,
            dry_run=args.dry_run,
            collectors=collectors or {},
        )
    except ValueError:
        outcomes, exit_code = [], 2
    _emit(outcomes, exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
