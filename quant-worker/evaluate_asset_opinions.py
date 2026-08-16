from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path

import psycopg

from ingest_market_data import load_database_url, psycopg_connection_url
from smart_insights.opinion_evaluation import evaluate_pending


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate mature daily asset opinions.")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args(argv)
    try:
        database_url = psycopg_connection_url(load_database_url(Path(args.env_file)))
        evaluated_at = datetime.now(timezone.utc)
        with psycopg.connect(database_url, autocommit=False) as connection:
            result = evaluate_pending(
                connection, evaluated_at=evaluated_at, limit=args.limit
            )
            connection.commit()
        print(
            json.dumps(
                {"status": "succeeded", **result, "evaluatedAt": evaluated_at.isoformat()},
                separators=(",", ":"),
            )
        )
        return 0
    except (OSError, ValueError, KeyError, psycopg.Error):
        print(
            json.dumps(
                {"status": "failed", "errorCode": "OPINION_EVALUATION_FAILED"},
                separators=(",", ":"),
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
