from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .models import Bar
from .quality import normalize_bars


@dataclass(frozen=True)
class ActiveSnapshot:
    dataset_id: str
    dataset_version_id: str
    version: int
    checksum: str
    source_metadata: Mapping[str, Any]
    rows: tuple[Bar, ...]
    missing_bar_count: int = 0
    quality_status: str = "passed"

    @property
    def is_fixture(self) -> bool:
        return self.source_metadata.get("mode") == "fixture" or any(
            row.source == "research_fixture" for row in self.rows
        )


def merge_snapshot(
    active_rows: Iterable[Bar],
    incoming_rows: Iterable[Bar],
    *,
    overlap_start: datetime,
) -> list[Bar]:
    active = list(active_rows)
    incoming = list(incoming_rows)
    if not incoming:
        raise ValueError("Snapshot merge requires at least one incoming bar.")

    expected_asset = incoming[0].asset
    expected_timeframe = incoming[0].timeframe
    combined = [*active, *incoming]
    if any(
        row.asset != expected_asset or row.timeframe != expected_timeframe
        for row in combined
    ):
        raise ValueError("Snapshot merge requires one asset and timeframe.")

    merged = {row.timestamp: row for row in active}
    for row in incoming:
        if row.timestamp >= overlap_start:
            merged[row.timestamp] = row
    return normalize_bars(merged.values())
