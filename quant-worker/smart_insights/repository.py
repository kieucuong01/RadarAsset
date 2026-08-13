from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import re
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from .artifacts import StoredArtifact
from .collectors.cryptocraft import CalendarEventInput
from .contracts import ObservationInput, RawSnapshot, SourceDefinition
from .metrics.crypto import (
    MarketClose,
    MetricDefinitionInput,
    ObservationPoint,
    SignalSnapshotInput,
)
from .validation import validate_observations


_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


class ConcurrentPublicationError(RuntimeError):
    pass


class UnknownMetricError(RuntimeError):
    pass


class UnknownAssetError(RuntimeError):
    pass


class MethodologyConflictError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class PublicationResult:
    snapshot_id: str | None
    provider_run_id: str
    status: str
    observations_inserted: int
    observations_unchanged: int


def _utc_key(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds")


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _natural_key(
    row: ObservationInput, *, source_code: str, asset_id: str | None
) -> str:
    canonical = "|".join(
        (
            row.metric_code,
            source_code,
            asset_id or "GLOBAL",
            _utc_key(row.effective_at),
            row.dimension_key,
        )
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class PostgresInsightRepository:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not connection.autocommit:
            raise ValueError("Smart Insights repository requires an autocommit connection.")
        self.connection = connection
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def publish(
        self,
        source: SourceDefinition,
        snapshot: RawSnapshot,
        artifact: StoredArtifact,
        rows: Sequence[ObservationInput],
    ) -> PublicationResult:
        validated = validate_observations(source, rows)
        self._verify_artifact(source, snapshot, artifact)
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                self._acquire_period_locks(cursor, source, validated)
                provider_id = self._upsert_provider(cursor, source)
                metrics = self._metric_ids(cursor, validated)
                assets = self._asset_ids(cursor, validated)
                snapshot_id = self._upsert_snapshot(
                    cursor, provider_id, source, snapshot, artifact, status="fetched"
                )
                inserted = 0
                unchanged = 0
                for row in validated:
                    asset_id = assets.get(row.asset_symbol) if row.asset_symbol else None
                    natural_key = _natural_key(
                        row, source_code=source.code, asset_id=asset_id
                    )
                    cursor.execute(
                        """
                        SELECT revision, value, raw_snapshot_id, quality_status, quality_flags
                        FROM metric_observations
                        WHERE natural_key = %s
                        ORDER BY revision DESC
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (natural_key,),
                    )
                    latest = cursor.fetchone()
                    if latest is not None and (
                        Decimal(str(latest["value"])) == row.value
                        and str(latest["raw_snapshot_id"]) == snapshot_id
                        and latest["quality_status"] == row.quality_status
                        and tuple(latest["quality_flags"]) == row.quality_flags
                    ):
                        unchanged += 1
                        continue
                    revision = 1 if latest is None else int(latest["revision"]) + 1
                    cursor.execute(
                        """
                        INSERT INTO metric_observations (
                          id, metric_definition_id, provider_id, asset_id,
                          raw_snapshot_id, effective_at, effective_start, effective_end,
                          published_at, observed_at, revision, value, natural_key,
                          dimension_key, dimensions, quality_status, quality_flags
                        ) VALUES (
                          %s, %s, %s, %s,
                          %s, %s, %s, %s,
                          %s, %s, %s, %s, %s,
                          %s, %s::jsonb, %s, %s::jsonb
                        )
                        """,
                        (
                            str(uuid4()),
                            metrics[row.metric_code],
                            provider_id,
                            asset_id,
                            snapshot_id,
                            row.effective_at,
                            row.effective_start,
                            row.effective_end,
                            row.published_at,
                            snapshot.observed_at,
                            revision,
                            row.value,
                            natural_key,
                            row.dimension_key,
                            json.dumps(dict(row.dimensions), separators=(",", ":")),
                            row.quality_status,
                            json.dumps(row.quality_flags, separators=(",", ":")),
                        ),
                    )
                    inserted += 1
                cursor.execute(
                    """
                    UPDATE insight_raw_snapshots
                    SET status = 'validated', error_code = NULL
                    WHERE id = %s
                    """,
                    (snapshot_id,),
                )
                status = "succeeded" if inserted else "unchanged"
                provider_run_id = self._insert_provider_run(
                    cursor,
                    source_code=source.code,
                    status="succeeded",
                    records_fetched=len(validated),
                    error_code=None,
                    retry_count=0,
                    started_at=snapshot.observed_at,
                    finished_at=self._clock(),
                    metadata={
                        "publicationStatus": status,
                        "snapshotId": snapshot_id,
                        "observationsInserted": inserted,
                        "observationsUnchanged": unchanged,
                    },
                )
        return PublicationResult(
            snapshot_id=snapshot_id,
            provider_run_id=provider_run_id,
            status=status,
            observations_inserted=inserted,
            observations_unchanged=unchanged,
        )

    def publish_calendar_batch(
        self,
        source: SourceDefinition,
        snapshot: RawSnapshot,
        artifact: StoredArtifact,
        events: Sequence[CalendarEventInput],
        *,
        job_code: str | None = None,
    ) -> PublicationResult:
        if source.code != "cryptocraft" and not source.code.startswith("qa-calendar-"):
            raise ValueError("Calendar publication requires a CryptoCraft source.")
        if not events:
            raise ValueError("Calendar publication requires at least one event.")
        if job_code is not None and not (
            job_code in {"cryptocraft-current", "cryptocraft-next"}
            or job_code.startswith("cryptocraft-event:cryptocraft:")
        ):
            raise ValueError("Calendar job code is not registered.")
        self._verify_artifact(source, snapshot, artifact)
        if len({event.source_event_key for event in events}) != len(events):
            raise ValueError("DUPLICATE_CONFLICT")
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                self._acquire_calendar_locks(cursor, source, events)
                provider_id = self._upsert_provider(cursor, source)
                snapshot_id = self._upsert_snapshot(
                    cursor, provider_id, source, snapshot, artifact, status="fetched"
                )
                inserted = 0
                unchanged = 0
                for event in events:
                    cursor.execute(
                        """
                        SELECT event, country, currency, impact, actual, forecast, previous,
                               event_date, event_at, time_status, source_timezone, detail_url,
                               published_at, revision, quality_status, quality_flags
                        FROM economic_events
                        WHERE source_code = %s AND source_event_key = %s
                        ORDER BY revision DESC
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (source.code, event.source_event_key),
                    )
                    latest = cursor.fetchone()
                    comparable = {
                        "event": event.name,
                        "country": event.country,
                        "currency": event.currency,
                        "impact": event.impact,
                        "actual": event.actual,
                        "forecast": event.forecast,
                        "previous": event.previous,
                        "event_date": event.event_date,
                        "event_at": event.event_at_utc,
                        "time_status": event.time_status,
                        "source_timezone": event.source_timezone,
                        "detail_url": event.detail_url,
                        "published_at": event.published_at,
                        "quality_status": event.quality_status,
                        "quality_flags": list(event.quality_flags),
                    }
                    if latest is not None and all(
                        latest[field] == value for field, value in comparable.items()
                    ):
                        unchanged += 1
                        continue
                    revision = 1 if latest is None else int(latest["revision"]) + 1
                    cursor.execute(
                        """
                        INSERT INTO economic_events (
                          id, source_code, source_event_key, event, country, currency,
                          impact, actual, forecast, previous, event_date, event_at,
                          time_status, source_timezone, detail_url, raw_snapshot_id,
                          published_at, observed_at, revision, quality_status,
                          quality_flags, created_at
                        ) VALUES (
                          %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s,
                          %s, %s, %s, %s,
                          %s::jsonb, NOW()
                        )
                        """,
                        (
                            str(uuid4()),
                            source.code,
                            event.source_event_key,
                            event.name,
                            event.country,
                            event.currency,
                            event.impact,
                            event.actual,
                            event.forecast,
                            event.previous,
                            event.event_date,
                            event.event_at_utc,
                            event.time_status,
                            event.source_timezone,
                            event.detail_url,
                            snapshot_id,
                            event.published_at,
                            snapshot.observed_at,
                            revision,
                            event.quality_status,
                            json.dumps(event.quality_flags, separators=(",", ":")),
                        ),
                    )
                    inserted += 1
                cursor.execute(
                    """
                    UPDATE insight_raw_snapshots
                    SET status = 'validated', error_code = NULL
                    WHERE id = %s
                    """,
                    (snapshot_id,),
                )
                status = "succeeded" if inserted else "unchanged"
                metadata: dict[str, object] = {
                    "publicationStatus": status,
                    "snapshotId": snapshot_id,
                    "eventsInserted": inserted,
                    "eventsUnchanged": unchanged,
                }
                if job_code is not None:
                    metadata["jobCode"] = job_code
                provider_run_id = self._insert_provider_run(
                    cursor,
                    source_code=source.code,
                    status="succeeded",
                    records_fetched=len(events),
                    error_code=None,
                    retry_count=0,
                    started_at=snapshot.observed_at,
                    finished_at=self._clock(),
                    metadata=metadata,
                )
        return PublicationResult(
            snapshot_id=snapshot_id,
            provider_run_id=provider_run_id,
            status=status,
            observations_inserted=inserted,
            observations_unchanged=unchanged,
        )

    def quarantine(
        self,
        source: SourceDefinition,
        snapshot: RawSnapshot,
        artifact: StoredArtifact,
        *,
        error_code: str,
    ) -> PublicationResult:
        self._validate_error_code(error_code)
        self._verify_artifact(source, snapshot, artifact)
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                provider_id = self._upsert_provider(cursor, source)
                snapshot_id = self._upsert_snapshot(
                    cursor,
                    provider_id,
                    source,
                    snapshot,
                    artifact,
                    status="quarantined",
                    error_code=error_code,
                )
                cursor.execute(
                    """
                    UPDATE insight_raw_snapshots
                    SET status = 'quarantined', error_code = %s
                    WHERE id = %s AND status <> 'validated'
                    """,
                    (error_code, snapshot_id),
                )
                provider_run_id = self._insert_provider_run(
                    cursor,
                    source_code=source.code,
                    status="quarantined",
                    records_fetched=0,
                    error_code=error_code,
                    retry_count=0,
                    started_at=snapshot.observed_at,
                    finished_at=self._clock(),
                    metadata={"snapshotId": snapshot_id},
                )
        return PublicationResult(
            snapshot_id=snapshot_id,
            provider_run_id=provider_run_id,
            status="quarantined",
            observations_inserted=0,
            observations_unchanged=0,
        )

    def record_failure(
        self,
        source: SourceDefinition,
        *,
        error_code: str,
        started_at: datetime,
        finished_at: datetime,
        retry_count: int,
    ) -> PublicationResult:
        self._validate_error_code(error_code)
        if (
            started_at.tzinfo is None
            or started_at.utcoffset() is None
            or finished_at.tzinfo is None
            or finished_at.utcoffset() is None
            or finished_at < started_at
            or retry_count < 0
        ):
            raise ValueError("Failure telemetry is invalid.")
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                self._upsert_provider(cursor, source)
                provider_run_id = self._insert_provider_run(
                    cursor,
                    source_code=source.code,
                    status="failed",
                    records_fetched=0,
                    error_code=error_code,
                    retry_count=retry_count,
                    started_at=started_at,
                    finished_at=finished_at,
                    metadata={},
                )
        return PublicationResult(
            snapshot_id=None,
            provider_run_id=provider_run_id,
            status="failed",
            observations_inserted=0,
            observations_unchanged=0,
        )

    def last_source_run(self, source_code: str) -> dict[str, Any] | None:
        return self._last_run(source_code, successful_only=False)

    def last_successful_source_run(self, source_code: str) -> dict[str, Any] | None:
        return self._last_run(source_code, successful_only=True)

    def last_successful_calendar_jobs(
        self, source_code: str = "cryptocraft"
    ) -> dict[str, datetime]:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT metadata ->> 'jobCode' AS job_code,
                       MAX(finished_at) AT TIME ZONE current_setting('TimeZone')
                         AS finished_at
                FROM provider_runs
                WHERE provider = %s
                  AND status = 'succeeded'
                  AND metadata ? 'jobCode'
                GROUP BY metadata ->> 'jobCode'
                """,
                (source_code,),
            )
            return {
                str(row["job_code"]): _as_utc(row["finished_at"])
                for row in cursor.fetchall()
                if row["job_code"] and row["finished_at"] is not None
            }

    def latest_calendar_events(
        self, *, as_of: datetime, source_code: str = "cryptocraft"
    ) -> tuple[CalendarEventInput, ...]:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("Calendar query time must be timezone-aware.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                WITH ranked AS (
                  SELECT event_row.*,
                         ROW_NUMBER() OVER (
                           PARTITION BY source_code, source_event_key
                           ORDER BY revision DESC
                         ) AS rank
                  FROM economic_events event_row
                  WHERE source_code = %s
                    AND observed_at <= %s
                    AND quality_status IN ('passed', 'warning')
                )
                SELECT id, source_event_key, event, country, currency, impact,
                       actual, forecast, previous, event_date, event_at,
                       time_status, source_timezone, detail_url, published_at,
                       observed_at, quality_status, quality_flags
                FROM ranked
                WHERE rank = 1
                ORDER BY event_date, event_at NULLS LAST, source_event_key
                """,
                (source_code, as_of),
            )
            return tuple(
                CalendarEventInput(
                    source_event_key=str(row["source_event_key"]),
                    name=str(row["event"]),
                    country=str(row["country"]),
                    currency=str(row["currency"]),
                    impact=str(row["impact"]),
                    actual=row["actual"],
                    forecast=row["forecast"],
                    previous=row["previous"],
                    event_date=row["event_date"],
                    event_at_utc=(
                        _as_utc(row["event_at"])
                        if row["event_at"] is not None
                        else None
                    ),
                    time_status=str(row["time_status"]),
                    source_timezone=str(row["source_timezone"]),
                    detail_url=row["detail_url"],
                    published_at=(
                        _as_utc(row["published_at"])
                        if row["published_at"] is not None
                        else None
                    ),
                    quality_status=str(row["quality_status"]),
                    quality_flags=tuple(row["quality_flags"]),
                    id=str(row["id"]),
                    observed_at=_as_utc(row["observed_at"]),
                )
                for row in cursor.fetchall()
            )

    def source_health_rows(self, source_code: str | None = None) -> list[dict[str, Any]]:
        parameters: tuple[object, ...] = () if source_code is None else (source_code,)
        where = "" if source_code is None else "WHERE provider.code = %s"
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                SELECT provider.code AS source_code,
                       provider.name AS source_name,
                       MAX(observation.effective_at) AS last_effective_at,
                       MAX(observation.observed_at) AS last_observed_at,
                       latest_run.status AS last_run_status,
                       latest_run.error_code AS last_error_code,
                       latest_quarantine.observed_at AS last_quarantined_at
                FROM data_providers provider
                LEFT JOIN metric_observations observation
                  ON observation.provider_id = provider.id
                 AND observation.quality_status IN ('passed', 'warning')
                LEFT JOIN LATERAL (
                  SELECT status, error_code
                  FROM provider_runs
                  WHERE provider_runs.provider = provider.code
                  ORDER BY finished_at DESC NULLS LAST, created_at DESC
                  LIMIT 1
                ) latest_run ON TRUE
                LEFT JOIN LATERAL (
                  SELECT observed_at
                  FROM insight_raw_snapshots
                  WHERE provider_id = provider.id AND status = 'quarantined'
                  ORDER BY observed_at DESC
                  LIMIT 1
                ) latest_quarantine ON TRUE
                {where}
                GROUP BY provider.code, provider.name, latest_run.status,
                         latest_run.error_code, latest_quarantine.observed_at
                ORDER BY provider.code
                """,
                parameters,
            )
            return [dict(row) for row in cursor.fetchall()]

    def upsert_metric_definitions(
        self, definitions: tuple[MetricDefinitionInput, ...]
    ) -> None:
        if len({definition.code for definition in definitions}) != len(definitions):
            raise ValueError("Metric definition codes must be unique.")
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                for definition in definitions:
                    cursor.execute(
                        "SELECT methodology_version FROM metric_definitions WHERE code = %s FOR UPDATE",
                        (definition.code,),
                    )
                    existing = cursor.fetchone()
                    if (
                        existing is not None
                        and existing["methodology_version"]
                        != definition.methodology_version
                    ):
                        raise MethodologyConflictError(
                            f"Metric {definition.code} uses another methodology version."
                        )
                    cursor.execute(
                        """
                        INSERT INTO metric_definitions (
                          id, code, market, name, unit, frequency, direction,
                          methodology_version, freshness_sla_minutes, metadata,
                          created_at, updated_at
                        ) VALUES (
                          %s, %s, %s, %s, %s, %s, %s,
                          %s, %s, %s::jsonb, NOW(), NOW()
                        )
                        ON CONFLICT (code) DO UPDATE SET
                          name = EXCLUDED.name,
                          unit = EXCLUDED.unit,
                          frequency = EXCLUDED.frequency,
                          direction = EXCLUDED.direction,
                          freshness_sla_minutes = EXCLUDED.freshness_sla_minutes,
                          metadata = EXCLUDED.metadata,
                          updated_at = NOW()
                        """,
                        (
                            str(uuid4()),
                            definition.code,
                            definition.market,
                            definition.name,
                            definition.unit,
                            definition.frequency,
                            definition.direction,
                            definition.methodology_version,
                            definition.freshness_sla_minutes,
                            json.dumps(
                                dict(definition.metadata), separators=(",", ":")
                            ),
                        ),
                    )

    def metric_observations(
        self, metric_code: str, *, as_of: datetime, limit: int = 5_000
    ) -> tuple[ObservationPoint, ...]:
        if as_of.tzinfo is None or as_of.utcoffset() is None or limit <= 0:
            raise ValueError("Observation query bounds are invalid.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                WITH ranked AS (
                  SELECT observation.id, metric.code AS metric_code,
                         observation.value, observation.effective_at,
                         observation.observed_at, provider.code AS provider_code,
                         observation.quality_status, observation.natural_key,
                         observation.revision, observation.dimensions,
                         asset.symbol AS asset_symbol, snapshot.status AS snapshot_status,
                         ROW_NUMBER() OVER (
                           PARTITION BY observation.natural_key
                           ORDER BY observation.revision DESC
                         ) AS revision_rank
                  FROM metric_observations observation
                  JOIN metric_definitions metric
                    ON metric.id = observation.metric_definition_id
                  JOIN data_providers provider ON provider.id = observation.provider_id
                  JOIN insight_raw_snapshots snapshot
                    ON snapshot.id = observation.raw_snapshot_id
                  LEFT JOIN assets asset ON asset.id = observation.asset_id
                  WHERE metric.code = %s
                    AND observation.effective_at <= %s
                    AND observation.observed_at <= %s
                )
                SELECT id, metric_code, value, effective_at, observed_at,
                       provider_code, quality_status, natural_key, revision,
                       dimensions, asset_symbol
                FROM ranked
                WHERE revision_rank = 1
                  AND quality_status IN ('passed', 'warning')
                  AND snapshot_status = 'validated'
                ORDER BY effective_at, natural_key
                LIMIT %s
                """,
                (metric_code, as_of, as_of, limit),
            )
            rows = cursor.fetchall()
        return tuple(
            ObservationPoint(
                id=str(row["id"]),
                metric_code=str(row["metric_code"]),
                value=Decimal(str(row["value"])),
                effective_at=row["effective_at"],
                observed_at=row["observed_at"],
                provider_code=str(row["provider_code"]),
                quality_status=str(row["quality_status"]),
                natural_key=str(row["natural_key"]),
                revision=int(row["revision"]),
                dimensions=dict(row["dimensions"]),
                asset_symbol=(
                    str(row["asset_symbol"])
                    if row["asset_symbol"] is not None
                    else None
                ),
            )
            for row in rows
        )

    def price_closes(
        self, asset_symbol: str, *, as_of: datetime, limit: int = 500
    ) -> tuple[MarketClose, ...]:
        if as_of.tzinfo is None or as_of.utcoffset() is None or limit <= 0:
            raise ValueError("Market close query bounds are invalid.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT bar.id, asset.symbol AS asset_symbol, bar.ts, bar.close,
                       version.published_at AS observed_at
                FROM dataset_bars bar
                JOIN dataset_versions version ON version.id = bar.dataset_version_id
                JOIN datasets dataset ON dataset.id = version.dataset_id
                JOIN assets asset ON asset.id = dataset.asset_id
                WHERE asset.symbol = %s
                  AND dataset.timeframe = '1d'
                  AND version.is_active = true
                  AND version.quality_status IN ('passed', 'warning')
                  AND version.published_at <= %s
                  AND bar.ts <= %s
                  AND bar.ingested_at <= %s
                ORDER BY bar.ts DESC
                LIMIT %s
                """,
                (asset_symbol, as_of, as_of, as_of, limit),
            )
            rows = list(reversed(cursor.fetchall()))
        return tuple(
            MarketClose(
                id=str(row["id"]),
                asset_symbol=str(row["asset_symbol"]),
                ts=row["ts"],
                close=Decimal(str(row["close"])),
                observed_at=_as_utc(row["observed_at"]),
            )
            for row in rows
        )

    def latest_signal_snapshot(
        self, *, market: str, as_of: datetime
    ) -> dict[str, Any] | None:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("Signal query time must be timezone-aware.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT score, label, effective_at, status
                FROM signal_snapshots
                WHERE market = %s AND signal_type = 'regime'
                  AND effective_at < %s
                ORDER BY effective_at DESC, created_at DESC
                LIMIT 1
                """,
                (market, as_of),
            )
            row = cursor.fetchone()
        return None if row is None else dict(row)

    def publish_signal_snapshot(
        self, snapshot: SignalSnapshotInput
    ) -> tuple[str, str]:
        inputs = [
            {
                "metricCode": row.metric_code,
                "value": format(row.value, "f"),
                "score": None if row.score is None else format(row.score, "f"),
                "percentile": (
                    None if row.percentile is None else format(row.percentile, "f")
                ),
                "configuredWeight": format(row.configured_weight, "f"),
                "effectiveAt": row.effective_at.isoformat(timespec="microseconds"),
                "observedAt": row.observed_at.isoformat(timespec="microseconds"),
                "sourceObservationIds": row.source_observation_ids,
                "qualityTier": format(row.quality_tier, "f"),
                "validationStatus": row.validation_status,
                "isFresh": row.is_fresh,
            }
            for row in snapshot.inputs
        ]
        asset_id: str | None = None
        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                if snapshot.asset_symbol is not None:
                    cursor.execute(
                        "SELECT id FROM assets WHERE symbol = %s",
                        (snapshot.asset_symbol,),
                    )
                    asset = cursor.fetchone()
                    if asset is None:
                        raise UnknownAssetError("Signal asset is not registered.")
                    asset_id = str(asset["id"])
                snapshot_id = str(uuid4())
                cursor.execute(
                    """
                    INSERT INTO signal_snapshots (
                      id, market, asset_id, effective_at, methodology_version,
                      signal_type, score, label, data_confidence, coverage,
                      inputs, status, idempotency_key, created_at
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s,
                      %s::jsonb, %s, %s, NOW()
                    )
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING id
                    """,
                    (
                        snapshot_id,
                        snapshot.market,
                        asset_id,
                        snapshot.effective_at,
                        snapshot.methodology_version,
                        snapshot.signal_type,
                        snapshot.score,
                        snapshot.label,
                        snapshot.data_confidence,
                        snapshot.coverage,
                        json.dumps(inputs, separators=(",", ":")),
                        snapshot.status,
                        snapshot.idempotency_key,
                    ),
                )
                inserted = cursor.fetchone()
                if inserted is not None:
                    return str(inserted["id"]), "succeeded"
                cursor.execute(
                    "SELECT id FROM signal_snapshots WHERE idempotency_key = %s",
                    (snapshot.idempotency_key,),
                )
                existing = cursor.fetchone()
                if existing is None:
                    raise RuntimeError("Signal idempotency lookup failed.")
                return str(existing["id"]), "unchanged"

    def _last_run(
        self, source_code: str, *, successful_only: bool
    ) -> dict[str, Any] | None:
        status_filter = "AND status = 'succeeded'" if successful_only else ""
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                SELECT provider, status, records_fetched, error_code, retry_count,
                       duration_ms, started_at, finished_at, created_at, metadata
                FROM provider_runs
                WHERE provider = %s {status_filter}
                ORDER BY finished_at DESC NULLS LAST, created_at DESC
                LIMIT 1
                """,
                (source_code,),
            )
            row = cursor.fetchone()
        return None if row is None else dict(row)

    @staticmethod
    def _validate_error_code(error_code: str) -> None:
        if not _ERROR_CODE.fullmatch(error_code):
            raise ValueError("Error code is not supported.")

    @staticmethod
    def _verify_artifact(
        source: SourceDefinition, snapshot: RawSnapshot, artifact: StoredArtifact
    ) -> None:
        expected_hash = hashlib.sha256(snapshot.content).hexdigest()
        if (
            artifact.content_hash != expected_hash
            or artifact.byte_count != len(snapshot.content)
            or not artifact.locator.startswith(f"{source.code}/")
        ):
            raise ValueError("Stored artifact does not match the source snapshot.")

    @staticmethod
    def _acquire_period_locks(
        cursor: psycopg.Cursor[Any],
        source: SourceDefinition,
        rows: Sequence[ObservationInput],
    ) -> None:
        effective_days = sorted(
            {row.effective_at.astimezone(timezone.utc).date().isoformat() for row in rows}
        )
        for effective_day in effective_days:
            lock_key = f"smart-insights:{source.code}:{effective_day}"
            cursor.execute(
                "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
                (lock_key,),
            )
            row = cursor.fetchone()
            if row is None or not row["acquired"]:
                raise ConcurrentPublicationError("Source period is already publishing.")

    @staticmethod
    def _acquire_calendar_locks(
        cursor: psycopg.Cursor[Any],
        source: SourceDefinition,
        events: Sequence[CalendarEventInput],
    ) -> None:
        for event_date in sorted({event.event_date for event in events}):
            lock_key = f"smart-insights:{source.code}:calendar:{event_date.isoformat()}"
            cursor.execute(
                "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
                (lock_key,),
            )
            row = cursor.fetchone()
            if row is None or not row["acquired"]:
                raise ConcurrentPublicationError("Calendar period is already publishing.")

    @staticmethod
    def _upsert_provider(
        cursor: psycopg.Cursor[Any], source: SourceDefinition
    ) -> str:
        cursor.execute(
            """
            INSERT INTO data_providers (
              id, code, name, terms_url, license_scope, status, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, 'active', NOW(), NOW())
            ON CONFLICT (code) DO UPDATE SET
              name = EXCLUDED.name,
              terms_url = COALESCE(EXCLUDED.terms_url, data_providers.terms_url),
              license_scope = CASE
                WHEN data_providers.license_scope = 'public_official'
                  OR EXCLUDED.license_scope = 'public_official'
                THEN 'public_official'
                ELSE data_providers.license_scope
              END,
              updated_at = NOW()
            RETURNING id
            """,
            (
                str(uuid4()),
                source.code,
                source.name,
                source.terms_url,
                source.license_scope.value,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError("Data provider upsert did not return an id.")
        return str(row["id"])

    @staticmethod
    def _metric_ids(
        cursor: psycopg.Cursor[Any], rows: Sequence[ObservationInput]
    ) -> dict[str, str]:
        codes = sorted({row.metric_code for row in rows})
        cursor.execute(
            "SELECT id, code FROM metric_definitions WHERE code = ANY(%s)", (codes,)
        )
        resolved = {str(row["code"]): str(row["id"]) for row in cursor.fetchall()}
        missing = set(codes) - set(resolved)
        if missing:
            raise UnknownMetricError("One or more metrics are not registered.")
        return resolved

    @staticmethod
    def _asset_ids(
        cursor: psycopg.Cursor[Any], rows: Sequence[ObservationInput]
    ) -> dict[str, str]:
        symbols = sorted({row.asset_symbol for row in rows if row.asset_symbol})
        if not symbols:
            return {}
        cursor.execute("SELECT id, symbol FROM assets WHERE symbol = ANY(%s)", (symbols,))
        resolved = {str(row["symbol"]): str(row["id"]) for row in cursor.fetchall()}
        if set(symbols) - set(resolved):
            raise UnknownAssetError("One or more assets are not registered.")
        return resolved

    @staticmethod
    def _upsert_snapshot(
        cursor: psycopg.Cursor[Any],
        provider_id: str,
        source: SourceDefinition,
        snapshot: RawSnapshot,
        artifact: StoredArtifact,
        *,
        status: str,
        error_code: str | None = None,
    ) -> str:
        cursor.execute(
            """
            INSERT INTO insight_raw_snapshots (
              id, provider_id, source_url, effective_at, published_at, observed_at,
              content_hash, content_type, storage_locator, parser_version,
              status, error_code, metadata
            ) VALUES (
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s::jsonb
            )
            ON CONFLICT (provider_id, source_url, content_hash) DO UPDATE
              SET provider_id = EXCLUDED.provider_id
            RETURNING id
            """,
            (
                str(uuid4()),
                provider_id,
                snapshot.source_url,
                snapshot.effective_at,
                snapshot.published_at,
                snapshot.observed_at,
                artifact.content_hash,
                snapshot.content_type,
                artifact.locator,
                source.parser_version,
                status,
                error_code,
                json.dumps(dict(snapshot.metadata), separators=(",", ":")),
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError("Snapshot upsert did not return an id.")
        return str(row["id"])

    @staticmethod
    def _insert_provider_run(
        cursor: psycopg.Cursor[Any],
        *,
        source_code: str,
        status: str,
        records_fetched: int,
        error_code: str | None,
        retry_count: int,
        started_at: datetime,
        finished_at: datetime,
        metadata: dict[str, object],
    ) -> str:
        provider_run_id = str(uuid4())
        duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1_000))
        cursor.execute(
            """
            INSERT INTO provider_runs (
              id, research_run_id, provider, status, records_fetched,
              error_message, error_code, retry_count, duration_ms, metadata,
              started_at, finished_at, created_at
            ) VALUES (
              %s, NULL, %s, %s, %s,
              NULL, %s, %s, %s, %s::jsonb,
              %s, %s, NOW()
            )
            """,
            (
                provider_run_id,
                source_code,
                status,
                records_fetched,
                error_code,
                retry_count,
                duration_ms,
                json.dumps(metadata, separators=(",", ":")),
                started_at,
                finished_at,
            ),
        )
        return provider_run_id
