from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg

from ingest_market_data import load_database_url, psycopg_connection_url
from smart_insights.kronos.adapter import build_request, load_upstream_predictor
from smart_insights.kronos.contracts import RuntimeLock
from smart_insights.kronos.evaluation import EvaluationResult, evaluate
from smart_insights.kronos.repository import PostgresKronosRepository, config_fingerprint


@dataclass(frozen=True)
class ShadowOutcome:
    status: str
    completed_oos: int
    run_id: str | None
    input_fingerprint: str


def _fingerprint_bars(bars) -> str:
    payload = [
        [bar.ts.isoformat(), bar.open, bar.high, bar.low, bar.close, bar.volume]
        for bar in bars
    ]
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode("utf-8")).hexdigest()


def run_shadow(
    repository,
    predictor,
    *,
    organization_id: str,
    as_of: datetime,
    evaluation_points: int,
    minimum_input_bars: int = 512,
    dry_run: bool,
    runtime_metadata: dict[str, Any],
) -> ShadowOutcome:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must include a timezone")
    as_of = as_of.astimezone(timezone.utc)
    config = {
        "asset": "BTC",
        "timeframe": "1d",
        "horizons": [1, 3, 7],
        "methodology": "kronos-btc-shadow-v1",
        "model": "kronos-small",
        "modelRevision": runtime_metadata.get("modelRevision"),
        "tokenizerRevision": runtime_metadata.get("tokenizerRevision"),
        "sourceRevision": runtime_metadata.get("sourceRevision"),
        "seed": 20260814,
        "sampleCount": 20,
        "temperature": 1.0,
        "topP": 0.9,
        "evaluationPoints": evaluation_points,
        "asOf": as_of.isoformat(),
    }
    config["configFingerprint"] = config_fingerprint(config)
    try:
        bars = repository.load_btc_bars(as_of)
        required = minimum_input_bars + evaluation_points + 7
        if len(bars) < required:
            raise ValueError(f"BTC history requires at least {required} daily bars; found {len(bars)}")
        input_fingerprint = _fingerprint_bars(bars)
        current_request = build_request(bars, as_of=as_of, max_context=min(minimum_input_bars, 512))
        current = predictor.forecast(current_request)
        evaluation: EvaluationResult = evaluate(
            bars,
            predictor,
            evaluation_points=evaluation_points,
            minimum_oos=180,
        )
        run_id = None
        if not dry_run:
            run_id = repository.persist_success(
                organization_id=organization_id,
                as_of=as_of,
                config=config,
                runtime_metadata=runtime_metadata,
                input_fingerprint=input_fingerprint,
                current=current,
                evaluation=evaluation,
            )
        return ShadowOutcome(evaluation.status, evaluation.completed_forecasts, run_id, input_fingerprint)
    except Exception as error:
        if not dry_run:
            repository.persist_failure(
                organization_id=organization_id,
                as_of=as_of,
                config=config,
                error_code=type(error).__name__.upper()[:64],
                error_message=str(error),
            )
        raise


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run isolated BTC Kronos shadow evaluation")
    parser.add_argument("--asset", choices=("BTC",), default="BTC")
    parser.add_argument("--as-of", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--evaluation-points", type=int, default=180)
    parser.add_argument("--organization-id", default=os.getenv("KRONOS_ORGANIZATION_ID"))
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("--as-of must include a timezone")
    return parsed.astimezone(timezone.utc)


def main() -> int:
    args = build_parser().parse_args()
    if not args.organization_id:
        raise ValueError("--organization-id or KRONOS_ORGANIZATION_ID is required")
    worker_root = Path(__file__).resolve().parent
    runtime_root = worker_root / ".runtime"
    lock_value = json.loads((worker_root / "third_party/kronos.lock.json").read_text(encoding="utf-8"))
    lock = RuntimeLock.from_manifest(lock_value, runtime_root)
    manifest_path = runtime_root / "sha256-manifest.json"
    runtime_metadata = {
        "device": args.device,
        "sourceRevision": lock.source_revision,
        "modelRevision": lock.model_revision,
        "tokenizerRevision": lock.tokenizer_revision,
        "manifestDigest": hashlib.sha256(manifest_path.read_bytes()).hexdigest() if manifest_path.exists() else None,
        "seed": 20260814,
    }
    predictor = load_upstream_predictor(lock, args.device)
    database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
    with psycopg.connect(database_url, autocommit=True) as connection:
        outcome = run_shadow(
            PostgresKronosRepository(connection),
            predictor,
            organization_id=args.organization_id,
            as_of=_parse_datetime(args.as_of),
            evaluation_points=args.evaluation_points,
            dry_run=args.dry_run,
            runtime_metadata=runtime_metadata,
        )
    print(json.dumps(outcome.__dict__, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
