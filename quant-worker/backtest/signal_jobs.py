from __future__ import annotations

from typing import Any, Protocol


class SqlCursor(Protocol):
    rowcount: int
    def execute(self, sql: str, params: tuple[Any, ...]) -> None: ...


def enqueue_strategy_evaluations(cursor: SqlCursor, dataset_version_id: str, asset_id: str) -> int:
    cursor.execute(
        """
        INSERT INTO strategy_evaluation_jobs (
          id, organization_id, assignment_id, dataset_version_id, status, attempt_count, created_at
        )
        SELECT gen_random_uuid(), assignment.organization_id, assignment.id,
               published.id, 'queued', 0, NOW()
        FROM dataset_versions AS published
        JOIN datasets AS dataset ON dataset.id = published.dataset_id
        JOIN strategy_assignments AS assignment ON assignment.asset_id = dataset.asset_id
        JOIN strategy_versions AS version ON version.id = assignment.strategy_version_id
        JOIN quant_runs AS run ON run.id = assignment.source_quant_run_id
        WHERE published.id = %s
          AND assignment.asset_id = %s
          AND assignment.asset_id = dataset.asset_id
          AND run.timeframe = dataset.timeframe
          AND published.is_active = true
          AND published.quality_status IN ('passed', 'warning')
          AND assignment.status = 'active'
          AND version.status = 'active'
        ON CONFLICT (assignment_id, dataset_version_id) DO NOTHING
        """,
        (dataset_version_id, asset_id),
    )
    return max(0, int(cursor.rowcount))
