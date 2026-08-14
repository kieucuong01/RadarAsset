from __future__ import annotations

from datetime import datetime, timedelta, timezone

from smart_insights.kronos.contracts import ForecastDistribution, ForecastPoint
from smart_insights.kronos.evaluation import EvaluationMetric, EvaluationResult
from smart_insights.kronos.repository import PostgresKronosRepository, config_fingerprint


class Cursor:
    def __init__(self, prior_rows=None):
        self.calls = []
        self.many = []
        self._row = None
        self._rows = []
        self.prior_rows = prior_rows or []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, query, params=()):
        normalized = " ".join(query.split())
        self.calls.append((normalized, params))
        if "SELECT id FROM research_runs" in normalized:
            self._row = None
        elif "SELECT id FROM assets" in normalized:
            self._row = {"id": "asset-id"}
        elif "INSERT INTO research_runs" in normalized:
            self._row = {"id": "run-id"}
        elif "INSERT INTO provider_runs" in normalized and "RETURNING id" in normalized:
            self._row = {"id": "provider-run-id"}
        elif "FROM model_evaluations" in normalized:
            self._rows = self.prior_rows
            self._row = None
        else:
            self._row = None

    def executemany(self, query, params):
        self.many.append((" ".join(query.split()), list(params)))

    def fetchone(self):
        return self._row

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows


class Transaction:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class Connection:
    autocommit = True

    def __init__(self, prior_rows=None):
        self.cursor_value = Cursor(prior_rows)

    def transaction(self):
        return Transaction()

    def cursor(self, **_):
        return self.cursor_value


def output():
    now = datetime(2026, 8, 14, tzinfo=timezone.utc)
    distribution = ForecastDistribution(
        tuple(ForecastPoint(days, now + timedelta(days=days), 90, 100, 110) for days in (1, 3, 7)),
        20260814,
        20,
        1.0,
        0.9,
    )
    evaluation = EvaluationResult(
        "kronos-btc-shadow-v1",
        "ACCUMULATING",
        1,
        180,
        (),
        (EvaluationMetric("kronos-small", 1, 1, 0.5, 0.1, 0.8, 0),),
        now - timedelta(days=8),
        now - timedelta(days=7),
    )
    return now, distribution, evaluation


def test_fingerprint_is_stable_and_sensitive() -> None:
    first = config_fingerprint({"asset": "BTC", "seed": 1})
    assert first == config_fingerprint({"seed": 1, "asset": "BTC"})
    assert first != config_fingerprint({"asset": "BTC", "seed": 2})


def test_btc_history_comes_from_the_active_validated_dataset() -> None:
    connection = Connection()
    PostgresKronosRepository(connection).load_btc_bars(
        datetime(2026, 8, 14, tzinfo=timezone.utc)
    )
    sql = connection.cursor_value.calls[-1][0]
    assert "dataset_bars" in sql
    assert "version.is_active = TRUE" in sql
    assert "version.quality_status" in sql
    assert "source_metadata->>'mode' = 'live'" in sql


def test_success_is_a_single_transaction_with_idempotent_forecast_upserts() -> None:
    connection = Connection()
    repo = PostgresKronosRepository(connection)
    now, distribution, evaluation = output()
    run_id = repo.persist_success(
        organization_id="org-id",
        as_of=now,
        config={"configFingerprint": "fingerprint", "modelRevision": "revision"},
        runtime_metadata={"device": "cpu", "seed": 20260814},
        input_fingerprint="input",
        current=distribution,
        evaluation=evaluation,
    )

    assert run_id == "run-id"
    sql = " ".join(query for query, _ in connection.cursor_value.calls)
    assert "ON CONFLICT" in connection.cursor_value.many[0][0]
    assert "model_evaluations" in sql
    assert "status = 'succeeded'" in sql


def test_failure_writes_provenance_but_no_forecasts() -> None:
    connection = Connection()
    repo = PostgresKronosRepository(connection)
    repo.persist_failure(
        organization_id="org-id",
        as_of=datetime(2026, 8, 14, tzinfo=timezone.utc),
        config={"configFingerprint": "failed"},
        error_code="RUNTIME_UNAVAILABLE",
        error_message="runtime missing",
    )

    assert connection.cursor_value.many == []
    sql = " ".join(query for query, _ in connection.cursor_value.calls)
    assert "provider_runs" in sql
    assert "'failed'" in sql


def test_success_merges_prior_daily_shadow_records_into_latest_evaluation() -> None:
    generated_at = datetime(2026, 8, 5, tzinfo=timezone.utc)
    prior = {
        "metrics": {
            "rollingErrors": [
                {
                    "model": "kronos-small",
                    "horizon": 1,
                    "forecastGeneratedAt": generated_at.isoformat(),
                    "maxInputTs": generated_at.isoformat(),
                    "forecastFor": (generated_at + timedelta(days=1)).isoformat(),
                    "predicted": 101,
                    "lower": 99,
                    "upper": 103,
                    "actual": 102,
                    "cutoffPrice": 100,
                    "absoluteError": 1,
                    "scaledAbsoluteError": 0.5,
                    "directionCorrect": True,
                    "volatilityRegime": "NORMAL",
                }
            ]
        }
    }
    connection = Connection([prior])
    repo = PostgresKronosRepository(connection)
    now, distribution, evaluation = output()

    repo.persist_success(
        organization_id="org-id",
        as_of=now,
        config={"configFingerprint": "fingerprint", "modelRevision": "revision"},
        runtime_metadata={"device": "cpu", "seed": 20260814},
        input_fingerprint="input",
        current=distribution,
        evaluation=evaluation,
    )

    evaluation_insert = next(
        params
        for query, params in connection.cursor_value.calls
        if "INSERT INTO model_evaluations" in query
    )
    payload = __import__("json").loads(evaluation_insert[-1])
    assert payload["completedOos"] == 1
    assert payload["rollingErrors"][0]["forecastGeneratedAt"] == generated_at.isoformat()
    prior_query = next(
        query for query, _ in connection.cursor_value.calls if "FROM model_evaluations" in query
    )
    assert "ORDER BY evaluation.created_at DESC LIMIT 1" in prior_query
