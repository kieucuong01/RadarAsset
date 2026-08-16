from __future__ import annotations

import os
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from time import perf_counter
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
import pytest

from backtest.run_contracts import QueuedRun
from backtest.run_repository import PostgresWorkerRepository


def _test_database_url() -> str:
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests.")
    parts = urlsplit(raw_url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


@pytest.mark.parametrize("claimer_count", [20, 50])
def test_concurrent_claimers_never_double_claim_a_backtest(claimer_count: int) -> None:
    database_url = _test_database_url()
    organization_id = str(uuid4())
    slug = f"worker-concurrency-{uuid4().hex}"
    # Seed spare work because a developer may have the normal worker running
    # against TEST_DATABASE_URL. The invariant under test is that every one of
    # these simultaneous claimers receives a distinct run and owns its commit.
    run_ids = [str(uuid4()) for _ in range(claimer_count * 2)]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, %s, %s, NOW())",
                (organization_id, "Worker concurrency QA", slug),
            )
            cursor.executemany(
                """
                INSERT INTO quant_runs (
                    id, organization_id, strategy_name, status, progress,
                    parameters, dataset_version_ids, engine_version,
                    deadline_at, created_at
                ) VALUES (
                    %s, %s, 'MA Crossover Backtest', 'queued', 0,
                    '{}'::jsonb, '[]'::jsonb, 'concurrency-test-v1',
                    clock_timestamp() + INTERVAL '5 minutes', clock_timestamp()
                )
                """,
                [(run_id, organization_id) for run_id in run_ids],
            )
        connection.commit()

    barrier = Barrier(claimer_count)

    def claim(index: int) -> tuple[str | None, str | None, bool]:
        with psycopg.connect(database_url, autocommit=False) as connection:
            repository = PostgresWorkerRepository(
                connection,
                worker_id=f"concurrency-worker-{index}",
                lease_seconds=60,
            )
            barrier.wait(timeout=20)
            claimed = repository.claim_next_run()
            if claimed is None:
                return None, None, False
            completed = repository.complete_run(
                claimed,
                {"totalReturnPct": 0},
                [
                    {
                        "kind": "manifest",
                        "checksum": "a" * 64,
                        "payload": {"runId": claimed.id},
                        "rowCount": 1,
                        "schemaVersion": 1,
                    }
                ],
            )
            return claimed.id, claimed.organization_id, completed

    started = perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=claimer_count) as executor:
            claims = list(executor.map(claim, range(claimer_count)))
        elapsed = perf_counter() - started
        claimed_ids = [run_id for run_id, _organization_id, _completed in claims if run_id]
        assert len(claimed_ids) == claimer_count
        assert len(set(claimed_ids)) == claimer_count
        assert set(claimed_ids).issubset(set(run_ids))
        assert {organization for _run_id, organization, _completed in claims} == {organization_id}
        assert all(completed for _run_id, _organization, completed in claims)
        assert elapsed < 30
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT count(*) AS artifact_count,
                           count(DISTINCT quant_run_id) AS run_count
                    FROM quant_run_artifacts
                    WHERE organization_id = %s
                    """,
                    (organization_id,),
                )
                assert cursor.fetchone() == (claimer_count, claimer_count)
        print(
            json.dumps(
                {
                    "claimers": claimer_count,
                    "claimed": len(claimed_ids),
                    "completed": sum(completed for _run_id, _organization, completed in claims),
                    "artifacts": claimer_count,
                    "elapsedSeconds": round(elapsed, 4),
                },
                sort_keys=True,
            )
        )
    finally:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
            connection.commit()


def test_heartbeat_progress_is_monotonic_and_exhausted_stale_run_times_out() -> None:
    database_url = _test_database_url()
    organization_id = str(uuid4())
    slug = f"worker-lifecycle-{uuid4().hex}"
    active_id = str(uuid4())
    stale_id = str(uuid4())
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, %s, %s, NOW())",
                (organization_id, "Worker lifecycle QA", slug),
            )
            cursor.execute(
                """
                INSERT INTO quant_runs (
                    id, organization_id, strategy_name, status, progress,
                    parameters, dataset_version_ids, engine_version,
                    worker_id, lease_expires_at, attempt_count, deadline_at, created_at
                ) VALUES
                (%s, %s, 'MA Crossover Backtest', 'running', 5,
                 '{}'::jsonb, '[]'::jsonb, 'lifecycle-test-v1',
                 'worker-active', clock_timestamp() + INTERVAL '1 minute', 1,
                 clock_timestamp() + INTERVAL '5 minutes', clock_timestamp()),
                (%s, %s, 'MA Crossover Backtest', 'running', 5,
                 '{}'::jsonb, '[]'::jsonb, 'lifecycle-test-v1',
                 'worker-lost', clock_timestamp() - INTERVAL '1 minute', 3,
                 clock_timestamp() + INTERVAL '5 minutes', clock_timestamp())
                """,
                (active_id, organization_id, stale_id, organization_id),
            )
        connection.commit()

    try:
        with psycopg.connect(database_url, autocommit=False) as connection:
            repository = PostgresWorkerRepository(
                connection, worker_id="worker-active", lease_seconds=60
            )
            active = QueuedRun(
                id=active_id,
                organization_id=organization_id,
                strategy_hash="",
                parameters={},
                dataset_version_ids=(),
                worker_id="worker-active",
            )
            assert repository.checkpoint_run(active, 60) == "running"
            assert repository.checkpoint_run(active, 40) == "running"
            assert repository.recover_stale_runs() == 1

        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id::text, status, progress, last_heartbeat_at IS NOT NULL
                    FROM quant_runs WHERE id IN (%s, %s) ORDER BY id
                    """,
                    (active_id, stale_id),
                )
                rows = {row[0]: row[1:] for row in cursor.fetchall()}
        assert rows[active_id] == ("running", 60, True)
        assert rows[stale_id] == ("timed_out", 100, False)
    finally:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
            connection.commit()


def test_cancel_after_claim_wins_before_completion_and_writes_no_artifact() -> None:
    database_url = _test_database_url()
    organization_id = str(uuid4())
    run_id = str(uuid4())
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, %s, %s, NOW())",
                (organization_id, "Cancel race QA", f"cancel-race-{uuid4().hex}"),
            )
            cursor.execute(
                """
                INSERT INTO quant_runs (
                    id, organization_id, strategy_name, status, progress,
                    parameters, dataset_version_ids, engine_version, deadline_at, created_at
                ) VALUES (%s, %s, 'MA Crossover Backtest', 'queued', 0, '{}'::jsonb,
                          '[]'::jsonb, 'cancel-race-v1', clock_timestamp() + INTERVAL '5 minutes',
                          clock_timestamp())
                """,
                (run_id, organization_id),
            )
        connection.commit()

    try:
        with psycopg.connect(database_url, autocommit=False) as worker_connection:
            repository = PostgresWorkerRepository(
                worker_connection, worker_id="cancel-race-worker", lease_seconds=60
            )
            claimed = repository.claim_next_run()
            assert claimed is not None and claimed.id == run_id
            with psycopg.connect(database_url) as cancel_connection:
                with cancel_connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE quant_runs SET status = 'cancel_requested', cancel_requested_at = NOW() WHERE id = %s",
                        (run_id,),
                    )
                cancel_connection.commit()
            assert repository.checkpoint_run(claimed, 50) == "cancelled"
            assert not repository.complete_run(
                claimed,
                {"totalReturnPct": 1},
                [{
                    "kind": "manifest",
                    "checksum": "b" * 64,
                    "payload": {"runId": run_id},
                    "rowCount": 1,
                    "schemaVersion": 1,
                }],
            )
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT status, progress FROM quant_runs WHERE id = %s", (run_id,)
                )
                assert cursor.fetchone() == ("cancelled", 100)
                cursor.execute(
                    "SELECT count(*) FROM quant_run_artifacts WHERE quant_run_id = %s", (run_id,)
                )
                assert cursor.fetchone() == (0,)
    finally:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM organizations WHERE id = %s", (organization_id,))
            connection.commit()
