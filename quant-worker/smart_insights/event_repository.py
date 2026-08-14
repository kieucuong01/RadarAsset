from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from .artifacts import StoredArtifact
from .contracts import RawSnapshot, SourceDefinition
from .event_contracts import EventObservation
from .event_deduplication import (
    BaselineState,
    classify_match,
    event_match_score,
    update_baseline,
)
from .repository import PostgresInsightRepository


@dataclass(frozen=True, slots=True)
class EventCluster:
    cluster_key: str
    category: str
    title: str
    country: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    occurred_at: datetime
    normalized_severity: float | None
    corroboration_count: int
    status: str
    quality_flags: tuple[str, ...]
    observation_keys: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class EventPublicationResult:
    inserted: int
    unchanged: int
    clusters_created: int
    review_required: int


@dataclass(frozen=True, slots=True)
class EventRiskEvidence:
    cluster_key: str
    category: str
    normalized_severity: float | None
    corroboration_count: int
    occurred_at: datetime
    observed_at: datetime
    observation_ids: tuple[str, ...]
    provider_codes: tuple[str, ...]


def _cluster_key(event: EventObservation) -> str:
    raw = "|".join(
        (
            event.category,
            event.country or "GLOBAL",
            event.occurred_at.strftime("%Y-%m-%dT%H"),
            event.source_code,
            event.source_event_key,
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _baseline_key(cluster: EventCluster) -> str:
    return ":".join(
        (
            cluster.category,
            cluster.country or "GLOBAL",
            str(cluster.occurred_at.weekday()),
            str(cluster.occurred_at.month),
        )
    )


def _new_cluster(event: EventObservation, *, status: str = "active") -> EventCluster:
    return EventCluster(
        cluster_key=_cluster_key(event),
        category=event.category,
        title=event.title,
        country=event.country,
        region=event.region,
        latitude=event.latitude,
        longitude=event.longitude,
        occurred_at=event.occurred_at,
        normalized_severity=event.normalized_severity,
        corroboration_count=1,
        status=status,
        quality_flags=("dedup_review_required",) if status == "review" else (),
        observation_keys=((event.source_code, event.source_event_key),),
    )


class EventRepository:
    """Atomic in-memory event store used by the deterministic pipeline and tests.

    The PostgreSQL publisher mirrors these state transitions inside one database
    transaction; this class keeps calculation behavior free from database I/O.
    """

    def __init__(self) -> None:
        self._observations: dict[tuple[str, str], EventObservation] = {}
        self._clusters: dict[str, EventCluster] = {}
        self._baselines: dict[str, BaselineState] = {}

    def publish(self, events: tuple[EventObservation, ...]) -> EventPublicationResult:
        observations = dict(self._observations)
        clusters = dict(self._clusters)
        baselines = dict(self._baselines)
        inserted = unchanged = created = review_required = 0
        for event in events:
            observation_key = (event.source_code, event.source_event_key)
            existing = observations.get(observation_key)
            if existing is not None and existing.content_hash == event.content_hash:
                unchanged += 1
                continue
            if existing is not None:
                observations[observation_key] = event
                unchanged += 1
                continue

            candidates: list[tuple[float, EventCluster, EventObservation]] = []
            for cluster in clusters.values():
                representative_key = cluster.observation_keys[0]
                representative = observations[representative_key]
                candidates.append((event_match_score(representative, event), cluster, representative))
            candidates.sort(key=lambda item: item[0], reverse=True)
            best_score = candidates[0][0] if candidates else 0.0
            decision = classify_match(best_score)
            if candidates and decision == "match":
                cluster = candidates[0][1]
                keys = cluster.observation_keys + (observation_key,)
                provider_count = len({source for source, _key in keys})
                severities = [
                    value
                    for value in (cluster.normalized_severity, event.normalized_severity)
                    if value is not None
                ]
                clusters[cluster.cluster_key] = replace(
                    cluster,
                    corroboration_count=provider_count,
                    normalized_severity=max(severities) if severities else None,
                    observation_keys=keys,
                )
            else:
                status = "review" if decision == "review" else "active"
                cluster = _new_cluster(event, status=status)
                clusters[cluster.cluster_key] = cluster
                baseline_key = _baseline_key(cluster)
                baselines[baseline_key] = update_baseline(
                    baselines.get(baseline_key, BaselineState.empty(baseline_key)),
                    1.0,
                )
                created += 1
                review_required += int(status == "review")
            observations[observation_key] = event
            inserted += 1

        self._observations = observations
        self._clusters = clusters
        self._baselines = baselines
        return EventPublicationResult(inserted, unchanged, created, review_required)

    def clusters(self) -> tuple[EventCluster, ...]:
        return tuple(sorted(self._clusters.values(), key=lambda item: item.occurred_at, reverse=True))

    def baselines(self) -> tuple[BaselineState, ...]:
        return tuple(sorted(self._baselines.values(), key=lambda item: item.baseline_key))

    def observations(self) -> tuple[EventObservation, ...]:
        return tuple(self._observations.values())


def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def _event_from_row(row: dict[str, Any]) -> EventObservation:
    return EventObservation(
        source_code=str(row["source_code"]),
        source_event_key=str(row["provider_event_key"]),
        category=str(row["category"]),
        subcategory=row["subcategory"],
        title=str(row["title"]),
        occurred_at=row["occurred_at"],
        first_observed_at=row["first_observed_at"],
        last_observed_at=row["last_observed_at"],
        normalized_severity=(
            None
            if row["normalized_severity"] is None
            else float(row["normalized_severity"])
        ),
        provider_severity=(
            None
            if row["provider_severity"] is None
            else float(row["provider_severity"])
        ),
        country=row["country"],
        region=row["region"],
        latitude=None if row["latitude"] is None else float(row["latitude"]),
        longitude=None if row["longitude"] is None else float(row["longitude"]),
        affected_count=row["affected_count"],
        fatalities=row["fatalities"],
        source_url=row["source_url"],
        parser_version=str(row["parser_version"]),
        quality_flags=tuple(row["quality_flags"]),
        dimensions=row["dimensions"],
        content_hash=str(row["content_hash"]),
    )


class PostgresEventRepository:
    """Transactional publisher for normalized global-event evidence."""

    def __init__(
        self,
        connection: psycopg.Connection[Any],
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not connection.autocommit:
            raise ValueError("Smart Insights event repository requires an autocommit connection.")
        self.connection = connection
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def publish(
        self,
        source: SourceDefinition,
        snapshot: RawSnapshot,
        artifact: StoredArtifact,
        events: Sequence[EventObservation],
    ) -> EventPublicationResult:
        if not events:
            raise ValueError("Event publication requires at least one event.")
        if len(events) > source.max_rows:
            raise ValueError("Event publication exceeds the source row limit.")
        if any(event.source_code != source.code for event in events):
            raise ValueError("Event source does not match its source definition.")
        keys = [event.source_event_key for event in events]
        if len(keys) != len(set(keys)):
            raise ValueError("DUPLICATE_CONFLICT")
        PostgresInsightRepository._verify_artifact(source, snapshot, artifact)

        with self.connection.transaction():
            with self.connection.cursor(row_factory=dict_row) as cursor:
                self._acquire_lock(cursor, source, snapshot.observed_at)
                provider_id = PostgresInsightRepository._upsert_provider(cursor, source)
                snapshot_id = PostgresInsightRepository._upsert_snapshot(
                    cursor, provider_id, source, snapshot, artifact, status="fetched"
                )
                inserted = unchanged = created = review_required = 0
                for event in events:
                    cursor.execute(
                        """
                        SELECT observation.id, observation.content_hash, member.cluster_id
                        FROM global_event_observations observation
                        LEFT JOIN global_event_cluster_members member
                          ON member.observation_id = observation.id
                        WHERE observation.provider_id = %s
                          AND observation.provider_event_key = %s
                        FOR UPDATE OF observation
                        """,
                        (provider_id, event.source_event_key),
                    )
                    existing = cursor.fetchone()
                    if existing is not None:
                        if str(existing["content_hash"]) == event.content_hash:
                            unchanged += 1
                            continue
                        self._update_observation(
                            cursor, str(existing["id"]), snapshot_id, event
                        )
                        if existing["cluster_id"] is not None:
                            self._refresh_cluster(cursor, str(existing["cluster_id"]))
                        unchanged += 1
                        continue

                    candidates = self._candidate_clusters(cursor, event)
                    best = max(
                        (
                            (event_match_score(candidate_event, event), cluster_id)
                            for cluster_id, candidate_event in candidates
                        ),
                        default=(0.0, None),
                        key=lambda item: item[0],
                    )
                    decision = classify_match(best[0])
                    if best[1] is not None and decision == "match":
                        cluster_id = best[1]
                    else:
                        status = "review" if decision == "review" else "active"
                        cluster_id = self._insert_cluster(cursor, event, status=status)
                        self._update_baseline(cursor, _new_cluster(event, status=status))
                        created += 1
                        review_required += int(status == "review")
                    observation_id = self._insert_observation(
                        cursor, provider_id, snapshot_id, event
                    )
                    cursor.execute(
                        """
                        INSERT INTO global_event_cluster_members (
                          id, cluster_id, observation_id, match_score, created_at
                        ) VALUES (%s, %s, %s, %s, NOW())
                        """,
                        (str(uuid4()), cluster_id, observation_id, Decimal(str(best[0]))),
                    )
                    self._refresh_cluster(cursor, cluster_id)
                    inserted += 1

                cursor.execute(
                    """
                    UPDATE insight_raw_snapshots
                    SET status = 'validated', error_code = NULL
                    WHERE id = %s
                    """,
                    (snapshot_id,),
                )
                PostgresInsightRepository._insert_provider_run(
                    cursor,
                    source_code=source.code,
                    status="succeeded",
                    records_fetched=len(events),
                    error_code=None,
                    retry_count=0,
                    started_at=snapshot.observed_at,
                    finished_at=max(snapshot.observed_at, self._clock()),
                    metadata={
                        "publicationStatus": "succeeded" if inserted else "unchanged",
                        "snapshotId": snapshot_id,
                        "eventsInserted": inserted,
                        "eventsUnchanged": unchanged,
                        "clustersCreated": created,
                        "reviewRequired": review_required,
                    },
                )
        return EventPublicationResult(inserted, unchanged, created, review_required)

    @staticmethod
    def _acquire_lock(
        cursor: psycopg.Cursor[Any], source: SourceDefinition, observed_at: datetime
    ) -> None:
        lock_key = f"smart-insights:{source.code}:events:{observed_at.date().isoformat()}"
        cursor.execute(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
            (lock_key,),
        )
        row = cursor.fetchone()
        if row is None or not row["acquired"]:
            raise RuntimeError("Source event period is already publishing.")

    @staticmethod
    def _candidate_clusters(
        cursor: psycopg.Cursor[Any], event: EventObservation
    ) -> list[tuple[str, EventObservation]]:
        cursor.execute(
            """
            SELECT cluster.id AS cluster_id, provider.code AS source_code,
                   observation.provider_event_key, observation.category,
                   observation.subcategory, observation.title, observation.occurred_at,
                   observation.first_observed_at, observation.last_observed_at,
                   observation.normalized_severity, observation.provider_severity,
                   observation.country, observation.region, observation.latitude,
                   observation.longitude, observation.affected_count,
                   observation.fatalities, observation.source_url,
                   observation.parser_version, observation.quality_flags,
                   observation.dimensions, observation.content_hash
            FROM global_event_clusters cluster
            JOIN LATERAL (
              SELECT member.observation_id
              FROM global_event_cluster_members member
              WHERE member.cluster_id = cluster.id
              ORDER BY member.created_at, member.id
              LIMIT 1
            ) representative ON TRUE
            JOIN global_event_observations observation
              ON observation.id = representative.observation_id
            JOIN data_providers provider ON provider.id = observation.provider_id
            WHERE cluster.category = %s
              AND cluster.occurred_at BETWEEN %s AND %s
            """,
            (
                event.category,
                event.occurred_at - timedelta(hours=72),
                event.occurred_at + timedelta(hours=72),
            ),
        )
        return [
            (str(row["cluster_id"]), _event_from_row(dict(row)))
            for row in cursor.fetchall()
        ]

    @staticmethod
    def _insert_observation(
        cursor: psycopg.Cursor[Any],
        provider_id: str,
        snapshot_id: str,
        event: EventObservation,
    ) -> str:
        observation_id = str(uuid4())
        cursor.execute(
            """
            INSERT INTO global_event_observations (
              id, provider_id, raw_snapshot_id, provider_event_key, category,
              subcategory, title, country, region, latitude, longitude,
              occurred_at, first_observed_at, last_observed_at,
              normalized_severity, provider_severity, affected_count, fatalities,
              source_url, content_hash, parser_version, quality_status,
              quality_flags, dimensions, created_at
            ) VALUES (
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s, 'passed',
              %s::jsonb, %s::jsonb, NOW()
            )
            """,
            (
                observation_id,
                provider_id,
                snapshot_id,
                event.source_event_key,
                event.category,
                event.subcategory,
                event.title,
                event.country,
                event.region,
                event.latitude,
                event.longitude,
                event.occurred_at,
                event.first_observed_at,
                event.last_observed_at,
                event.normalized_severity,
                event.provider_severity,
                event.affected_count,
                event.fatalities,
                event.source_url,
                event.content_hash,
                event.parser_version,
                _json(event.quality_flags),
                _json(dict(event.dimensions)),
            ),
        )
        return observation_id

    @staticmethod
    def _update_observation(
        cursor: psycopg.Cursor[Any],
        observation_id: str,
        snapshot_id: str,
        event: EventObservation,
    ) -> None:
        cursor.execute(
            """
            UPDATE global_event_observations
            SET raw_snapshot_id = %s, category = %s, subcategory = %s,
                title = %s, country = %s, region = %s, latitude = %s,
                longitude = %s, occurred_at = %s, last_observed_at = %s,
                normalized_severity = %s, provider_severity = %s,
                affected_count = %s, fatalities = %s, source_url = %s,
                content_hash = %s, parser_version = %s,
                quality_flags = %s::jsonb, dimensions = %s::jsonb
            WHERE id = %s
            """,
            (
                snapshot_id,
                event.category,
                event.subcategory,
                event.title,
                event.country,
                event.region,
                event.latitude,
                event.longitude,
                event.occurred_at,
                event.last_observed_at,
                event.normalized_severity,
                event.provider_severity,
                event.affected_count,
                event.fatalities,
                event.source_url,
                event.content_hash,
                event.parser_version,
                _json(event.quality_flags),
                _json(dict(event.dimensions)),
                observation_id,
            ),
        )

    @staticmethod
    def _insert_cluster(
        cursor: psycopg.Cursor[Any], event: EventObservation, *, status: str
    ) -> str:
        cluster_id = str(uuid4())
        flags = ("dedup_review_required",) if status == "review" else ()
        cursor.execute(
            """
            INSERT INTO global_event_clusters (
              id, cluster_key, category, subcategory, title, country, region,
              latitude, longitude, occurred_at, normalized_severity,
              corroboration_count, status, quality_flags, created_at, updated_at
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              1, %s, %s::jsonb, NOW(), NOW()
            )
            """,
            (
                cluster_id,
                _cluster_key(event),
                event.category,
                event.subcategory,
                event.title,
                event.country,
                event.region,
                event.latitude,
                event.longitude,
                event.occurred_at,
                event.normalized_severity,
                status,
                _json(flags),
            ),
        )
        return cluster_id

    @staticmethod
    def _refresh_cluster(cursor: psycopg.Cursor[Any], cluster_id: str) -> None:
        cursor.execute(
            """
            UPDATE global_event_clusters cluster
            SET normalized_severity = aggregate.normalized_severity,
                corroboration_count = aggregate.corroboration_count,
                updated_at = NOW()
            FROM (
              SELECT member.cluster_id,
                     MAX(observation.normalized_severity) AS normalized_severity,
                     COUNT(DISTINCT observation.provider_id)::int AS corroboration_count
              FROM global_event_cluster_members member
              JOIN global_event_observations observation
                ON observation.id = member.observation_id
              WHERE member.cluster_id = %s
              GROUP BY member.cluster_id
            ) aggregate
            WHERE cluster.id = aggregate.cluster_id
            """,
            (cluster_id,),
        )

    @staticmethod
    def _update_baseline(cursor: psycopg.Cursor[Any], cluster: EventCluster) -> None:
        key = _baseline_key(cluster)
        cursor.execute(
            """
            SELECT count, mean, m2
            FROM event_baseline_states
            WHERE baseline_key = %s
            FOR UPDATE
            """,
            (key,),
        )
        row = cursor.fetchone()
        state = (
            BaselineState.empty(key)
            if row is None
            else BaselineState(key, int(row["count"]), float(row["mean"]), float(row["m2"]))
        )
        updated = update_baseline(state, 1.0)
        cursor.execute(
            """
            INSERT INTO event_baseline_states (
              id, baseline_key, event_category, region, weekday, month,
              count, mean, m2, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (baseline_key) DO UPDATE SET
              count = EXCLUDED.count,
              mean = EXCLUDED.mean,
              m2 = EXCLUDED.m2,
              updated_at = NOW()
            """,
            (
                str(uuid4()),
                key,
                cluster.category,
                cluster.country or "GLOBAL",
                cluster.occurred_at.weekday(),
                cluster.occurred_at.month,
                updated.count,
                updated.mean,
                updated.m2,
            ),
        )

    def clusters(self, *, as_of: datetime) -> tuple[EventCluster, ...]:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("Event cluster query time must be timezone-aware.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT cluster.id, cluster.cluster_key, cluster.category,
                       cluster.title, cluster.country, cluster.region,
                       cluster.latitude, cluster.longitude, cluster.occurred_at,
                       cluster.normalized_severity, cluster.corroboration_count,
                       cluster.status, cluster.quality_flags,
                       COALESCE(
                         jsonb_agg(
                           jsonb_build_array(provider.code, observation.provider_event_key)
                           ORDER BY provider.code, observation.provider_event_key
                         ) FILTER (WHERE observation.id IS NOT NULL),
                         '[]'::jsonb
                       ) AS observation_keys
                FROM global_event_clusters cluster
                LEFT JOIN global_event_cluster_members member
                  ON member.cluster_id = cluster.id
                LEFT JOIN global_event_observations observation
                  ON observation.id = member.observation_id
                LEFT JOIN data_providers provider ON provider.id = observation.provider_id
                WHERE cluster.occurred_at <= %s
                GROUP BY cluster.id
                ORDER BY cluster.occurred_at DESC, cluster.id
                """,
                (as_of,),
            )
            rows = cursor.fetchall()
        return tuple(
            EventCluster(
                cluster_key=str(row["cluster_key"]),
                category=str(row["category"]),
                title=str(row["title"]),
                country=row["country"],
                region=row["region"],
                latitude=None if row["latitude"] is None else float(row["latitude"]),
                longitude=None if row["longitude"] is None else float(row["longitude"]),
                occurred_at=row["occurred_at"],
                normalized_severity=(
                    None
                    if row["normalized_severity"] is None
                    else float(row["normalized_severity"])
                ),
                corroboration_count=int(row["corroboration_count"]),
                status=str(row["status"]),
                quality_flags=tuple(row["quality_flags"]),
                observation_keys=tuple(
                    (str(key[0]), str(key[1])) for key in row["observation_keys"]
                ),
            )
            for row in rows
        )

    def source_health(self, source_code: str) -> dict[str, Any]:
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT provider.code AS source_code,
                       MAX(observation.occurred_at) AS last_effective_at,
                       MAX(observation.last_observed_at) AS last_observed_at,
                       latest_run.status AS last_run_status,
                       latest_run.error_code AS last_error_code
                FROM data_providers provider
                LEFT JOIN global_event_observations observation
                  ON observation.provider_id = provider.id
                LEFT JOIN LATERAL (
                  SELECT status, error_code
                  FROM provider_runs
                  WHERE provider_runs.provider = provider.code
                  ORDER BY finished_at DESC NULLS LAST, created_at DESC
                  LIMIT 1
                ) latest_run ON TRUE
                WHERE provider.code = %s
                GROUP BY provider.code, latest_run.status, latest_run.error_code
                """,
                (source_code,),
            )
            row = cursor.fetchone()
        if row is None:
            raise KeyError(source_code)
        return dict(row)

    def risk_evidence(
        self, *, as_of: datetime, freshness_minutes: int = 360
    ) -> tuple[EventRiskEvidence, ...]:
        if as_of.tzinfo is None or as_of.utcoffset() is None or freshness_minutes <= 0:
            raise ValueError("Event risk query bounds are invalid.")
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT cluster.cluster_key, cluster.category,
                       cluster.normalized_severity, cluster.corroboration_count,
                       cluster.occurred_at,
                       MAX(observation.last_observed_at) AS observed_at,
                       array_agg(observation.id::text ORDER BY observation.id) AS observation_ids,
                       array_agg(DISTINCT provider.code ORDER BY provider.code) AS provider_codes
                FROM global_event_clusters cluster
                JOIN global_event_cluster_members member ON member.cluster_id = cluster.id
                JOIN global_event_observations observation
                  ON observation.id = member.observation_id
                JOIN data_providers provider ON provider.id = observation.provider_id
                WHERE observation.last_observed_at <= %s
                  AND observation.last_observed_at >= %s
                  AND cluster.occurred_at <= %s
                  AND cluster.status IN ('active', 'review')
                GROUP BY cluster.id
                ORDER BY cluster.occurred_at DESC, cluster.id
                LIMIT 500
                """,
                (as_of, as_of - timedelta(minutes=freshness_minutes), as_of),
            )
            rows = cursor.fetchall()
        return tuple(
            EventRiskEvidence(
                cluster_key=str(row["cluster_key"]),
                category=str(row["category"]),
                normalized_severity=(
                    None
                    if row["normalized_severity"] is None
                    else float(row["normalized_severity"])
                ),
                corroboration_count=int(row["corroboration_count"]),
                occurred_at=row["occurred_at"],
                observed_at=row["observed_at"],
                observation_ids=tuple(row["observation_ids"]),
                provider_codes=tuple(row["provider_codes"]),
            )
            for row in rows
        )
