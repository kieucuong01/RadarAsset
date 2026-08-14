from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from psycopg.rows import dict_row

from .contracts import Bar, ForecastDistribution
from .evaluation import EvaluationResult, EvaluationRun, accumulate_evaluation


def config_fingerprint(config: dict[str, Any]) -> str:
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


class PostgresKronosRepository:
    def __init__(self, connection) -> None:
        if not connection.autocommit:
            raise ValueError("Kronos repository requires an autocommit connection")
        self.connection = connection

    def load_btc_bars(self, as_of: datetime) -> list[Bar]:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT bar.ts, bar.open, bar.high, bar.low, bar.close,
                       COALESCE(bar.volume, 0) AS volume
                FROM dataset_bars AS bar
                JOIN dataset_versions AS version ON version.id = bar.dataset_version_id
                JOIN datasets AS dataset ON dataset.id = version.dataset_id
                JOIN assets AS asset ON asset.id = dataset.asset_id
                WHERE asset.symbol = 'BTC'
                  AND dataset.timeframe = '1d'
                  AND dataset.adjustment_policy = 'raw'
                  AND version.is_active = TRUE
                  AND version.quality_status IN ('passed', 'warning')
                  AND version.source_metadata->>'mode' = 'live'
                  AND bar.ts <= %s
                ORDER BY bar.ts ASC
                """,
                (as_of,),
            )
            return [
                Bar(
                    ts=row["ts"].astimezone(timezone.utc),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row["volume"]),
                )
                for row in cursor.fetchall()
            ]

    def accumulate_evaluation(
        self, organization_id: str, evaluation: EvaluationResult
    ) -> EvaluationResult:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            prior = self._prior_evaluation_runs(
                cursor, organization_id, evaluation.methodology
            )
        return accumulate_evaluation(evaluation, prior)

    @staticmethod
    def _asset_id(cursor) -> str:
        cursor.execute("SELECT id FROM assets WHERE symbol = 'BTC' LIMIT 1")
        row = cursor.fetchone()
        if row is None:
            raise ValueError("BTC asset is not configured")
        return str(row["id"])

    @staticmethod
    def _existing_run(cursor, organization_id: str, fingerprint: str) -> str | None:
        cursor.execute(
            """
            SELECT id FROM research_runs
            WHERE organization_id = %s
              AND source = 'kronos-small'
              AND kind = 'btc_shadow_forecast'
              AND parameters->>'configFingerprint' = %s
              AND status = 'completed'
            ORDER BY created_at DESC LIMIT 1
            """,
            (organization_id, fingerprint),
        )
        row = cursor.fetchone()
        return str(row["id"]) if row else None

    @staticmethod
    def _prior_evaluation_runs(
        cursor, organization_id: str, methodology: str
    ) -> tuple[EvaluationRun, ...]:
        cursor.execute(
            """
            SELECT evaluation.metrics
            FROM model_evaluations AS evaluation
            JOIN research_runs AS run ON run.id = evaluation.research_run_id
            WHERE run.organization_id = %s
              AND run.source = 'kronos-small'
              AND run.kind = 'btc_shadow_forecast'
              AND run.status = 'completed'
              AND evaluation.methodology_version = %s
            ORDER BY evaluation.created_at DESC
            LIMIT 1
            """,
            (organization_id, methodology),
        )
        keyed: dict[tuple[str, int, datetime], EvaluationRun] = {}
        for row in cursor.fetchall():
            payload = row.get("metrics") or {}
            if isinstance(payload, str):
                payload = json.loads(payload)
            for value in payload.get("rollingErrors", []):
                try:
                    generated_at = datetime.fromisoformat(
                        str(value["forecastGeneratedAt"]).replace("Z", "+00:00")
                    ).astimezone(timezone.utc)
                    record = EvaluationRun(
                        model=str(value["model"]),
                        horizon=int(value["horizon"]),
                        forecast_generated_at=generated_at,
                        max_input_ts=datetime.fromisoformat(
                            str(value["maxInputTs"]).replace("Z", "+00:00")
                        ).astimezone(timezone.utc),
                        forecast_for=datetime.fromisoformat(
                            str(value["forecastFor"]).replace("Z", "+00:00")
                        ).astimezone(timezone.utc),
                        predicted=float(value["predicted"]),
                        lower=float(value["lower"]) if value.get("lower") is not None else None,
                        upper=float(value["upper"]) if value.get("upper") is not None else None,
                        actual=float(value["actual"]),
                        cutoff_price=float(value["cutoffPrice"]),
                        absolute_error=float(value["absoluteError"]),
                        scaled_absolute_error=float(value["scaledAbsoluteError"]),
                        direction_correct=value.get("directionCorrect") is True,
                        volatility_regime=str(value["volatilityRegime"]),
                    )
                except (KeyError, TypeError, ValueError):
                    continue
                keyed[(record.model, record.horizon, generated_at)] = record
        return tuple(keyed.values())

    def persist_success(
        self,
        *,
        organization_id: str,
        as_of: datetime,
        config: dict[str, Any],
        runtime_metadata: dict[str, Any],
        input_fingerprint: str,
        current: ForecastDistribution,
        evaluation: EvaluationResult,
    ) -> str:
        fingerprint = str(config["configFingerprint"])
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                existing = self._existing_run(cursor, organization_id, fingerprint)
                if existing:
                    return existing
                evaluation = accumulate_evaluation(
                    evaluation,
                    self._prior_evaluation_runs(cursor, organization_id, evaluation.methodology),
                )
                asset_id = self._asset_id(cursor)
                parameters = {**config, "runtime": runtime_metadata, "inputFingerprint": input_fingerprint}
                cursor.execute(
                    """
                    INSERT INTO research_runs
                      (organization_id, asset_id, source, kind, status, parameters, started_at)
                    VALUES (%s, %s, 'kronos-small', 'btc_shadow_forecast', 'running', %s::jsonb, now())
                    RETURNING id
                    """,
                    (organization_id, asset_id, _json(parameters)),
                )
                run_id = str(cursor.fetchone()["id"])
                cursor.execute(
                    """
                    INSERT INTO provider_runs
                      (research_run_id, provider, status, metadata, started_at)
                    VALUES (%s, 'kronos-small', 'running', %s::jsonb, now())
                    RETURNING id
                    """,
                    (run_id, _json(runtime_metadata)),
                )
                provider_run_id = str(cursor.fetchone()["id"])

                model_revision = config.get("modelRevision")
                rows = [
                    (
                        asset_id,
                        run_id,
                        f"{point.days}d",
                        point.median,
                        point.lower,
                        point.upper,
                        80,
                        "kronos-small",
                        as_of,
                        point.forecast_for,
                        "shadow",
                        evaluation.methodology,
                        model_revision,
                        input_fingerprint,
                        None,
                        None,
                    )
                    for point in current.points
                ]
                rows.extend(
                    (
                        asset_id,
                        run_id,
                        f"{record.horizon}d",
                        record.predicted,
                        record.lower if record.lower is not None else record.predicted,
                        record.upper if record.upper is not None else record.predicted,
                        80,
                        "kronos-small",
                        record.forecast_generated_at,
                        record.forecast_for,
                        "evaluated",
                        evaluation.methodology,
                        model_revision,
                        input_fingerprint,
                        record.actual,
                        as_of,
                    )
                    for record in evaluation.runs
                    if record.model == "kronos-small"
                )
                cursor.executemany(
                    """
                    INSERT INTO forecast_points
                      (asset_id, research_run_id, horizon, target_price, lower_bound,
                       upper_bound, confidence, model, generated_at, forecast_for, status,
                       methodology_version, model_revision, input_fingerprint,
                       realized_price, evaluated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (research_run_id, model, horizon, generated_at)
                    DO UPDATE SET target_price = EXCLUDED.target_price,
                                  lower_bound = EXCLUDED.lower_bound,
                                  upper_bound = EXCLUDED.upper_bound,
                                  forecast_for = EXCLUDED.forecast_for,
                                  status = EXCLUDED.status,
                                  realized_price = EXCLUDED.realized_price,
                                  evaluated_at = EXCLUDED.evaluated_at
                    """,
                    rows,
                )
                metrics = [metric.__dict__ for metric in evaluation.metrics]
                rolling_errors = [
                    {
                        "ts": record.forecast_for.isoformat(),
                        "horizon": record.horizon,
                        "model": record.model,
                        "forecastGeneratedAt": record.forecast_generated_at.isoformat(),
                        "maxInputTs": record.max_input_ts.isoformat(),
                        "forecastFor": record.forecast_for.isoformat(),
                        "predicted": record.predicted,
                        "lower": record.lower,
                        "upper": record.upper,
                        "actual": record.actual,
                        "cutoffPrice": record.cutoff_price,
                        "absoluteError": record.absolute_error,
                        "scaledAbsoluteError": record.scaled_absolute_error,
                        "directionCorrect": record.direction_correct,
                        "volatilityRegime": record.volatility_regime,
                    }
                    for record in evaluation.runs
                ]
                cursor.execute(
                    """
                    INSERT INTO model_evaluations
                      (asset_id, research_run_id, model, task, status, methodology_version,
                       data_fingerprint, window_start, window_end, metrics)
                    VALUES (%s, %s, 'kronos-small', 'btc_price_forecast_1_3_7', %s, %s,
                            %s, %s, %s, %s::jsonb)
                    """,
                    (
                        asset_id,
                        run_id,
                        evaluation.status.lower(),
                        evaluation.methodology,
                        input_fingerprint,
                        evaluation.window_start,
                        evaluation.window_end,
                        _json(
                            {
                                "completedOos": evaluation.completed_forecasts,
                                "minimumOos": evaluation.minimum_oos,
                                "models": metrics,
                                "rollingErrors": rolling_errors,
                            }
                        ),
                    ),
                )
                cursor.execute(
                    """
                    UPDATE provider_runs
                    SET status = 'succeeded', records_fetched = %s, finished_at = now()
                    WHERE id = %s
                    """,
                    (len(rows), provider_run_id),
                )
                cursor.execute(
                    """
                    UPDATE research_runs
                    SET status = 'completed', summary = %s, finished_at = now()
                    WHERE id = %s
                    """,
                    (f"{evaluation.status}: {evaluation.completed_forecasts} OOS cutoffs", run_id),
                )
                return run_id

    def persist_failure(
        self,
        *,
        organization_id: str,
        as_of: datetime,
        config: dict[str, Any],
        error_code: str,
        error_message: str,
    ) -> None:
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                asset_id = self._asset_id(cursor)
                cursor.execute(
                    """
                    INSERT INTO research_runs
                      (organization_id, asset_id, source, kind, status, parameters,
                       summary, started_at, finished_at)
                    VALUES (%s, %s, 'kronos-small', 'btc_shadow_forecast', 'failed',
                            %s::jsonb, %s, %s, now())
                    RETURNING id
                    """,
                    (organization_id, asset_id, _json(config), error_code, as_of),
                )
                run_id = str(cursor.fetchone()["id"])
                cursor.execute(
                    """
                    INSERT INTO provider_runs
                      (research_run_id, provider, status, error_code, error_message,
                       metadata, started_at, finished_at)
                    VALUES (%s, 'kronos-small', 'failed', %s, %s, '{}'::jsonb, %s, now())
                    """,
                    (run_id, error_code, error_message[:500], as_of),
                )
