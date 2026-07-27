from __future__ import annotations

import json
import os
import statistics
from datetime import datetime, timezone
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row


DEFAULT_DATABASE_URL = (
    "postgresql://postgres:postgres@localhost:5432/quant_insight_radar?schema=public"
)


def load_local_env(path: str = ".env.local") -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def database_url() -> str:
    load_local_env()
    raw_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    parts = urlsplit(raw_url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query and query, parts.fragment))


def annualized_volatility(closes: Iterable[float]) -> float:
    prices = list(closes)
    if len(prices) < 3:
        return 0.0
    returns = [(prices[i] / prices[i - 1]) - 1 for i in range(1, len(prices)) if prices[i - 1]]
    if len(returns) < 2:
        return 0.0
    return statistics.stdev(returns) * (252**0.5)


def max_drawdown(closes: Iterable[float]) -> float:
    peak = 0.0
    worst = 0.0
    for price in closes:
        peak = max(peak, price)
        if peak:
            worst = min(worst, (price - peak) / peak)
    return worst


def symbols_from_parameters(parameters: object) -> list[str]:
    if not isinstance(parameters, dict):
        return ["BTC", "SPY"]

    symbols: list[str] = []
    raw_assets = parameters.get("assets")
    if isinstance(raw_assets, list):
        symbols.extend(str(symbol).upper() for symbol in raw_assets)

    raw_asset = parameters.get("assetTicker")
    if isinstance(raw_asset, str):
        symbols.append(raw_asset.upper())

    raw_legs = parameters.get("legs")
    if isinstance(raw_legs, list):
        for leg in raw_legs:
            if isinstance(leg, dict) and isinstance(leg.get("assetTicker"), str):
                symbols.append(str(leg["assetTicker"]).upper())

    return sorted(set(symbols)) or ["BTC", "SPY"]


def fetch_market_closes(conn: psycopg.Connection, symbols: list[str]) -> dict[str, list[float]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT a.symbol, mb.close::float AS close
            FROM market_bars mb
            JOIN assets a ON a.id = mb.asset_id
            WHERE a.symbol = ANY(%s) AND mb.timeframe = '1d'
            ORDER BY a.symbol ASC, mb.ts ASC
            """,
            (symbols,),
        )
        rows = cur.fetchall()

    closes: dict[str, list[float]] = {}
    for row in rows:
        closes.setdefault(str(row["symbol"]), []).append(float(row["close"]))
    return closes


def calculate_metrics(closes_by_symbol: dict[str, list[float]]) -> dict[str, object]:
    if not closes_by_symbol:
        return {
            "totalReturn": 0.0,
            "volatility": 0.0,
            "sharpe": 0.0,
            "maxDrawdown": 0.0,
            "symbols": [],
            "observations": 0,
        }

    returns: list[float] = []
    vols: list[float] = []
    drawdowns: list[float] = []
    observations = 0

    for closes in closes_by_symbol.values():
        if len(closes) < 2:
            continue
        observations += len(closes)
        returns.append((closes[-1] / closes[0]) - 1)
        vols.append(annualized_volatility(closes))
        drawdowns.append(max_drawdown(closes))

    avg_return = statistics.fmean(returns) if returns else 0.0
    avg_vol = statistics.fmean(vols) if vols else 0.0
    risk_free = 0.04
    sharpe = ((avg_return * 252 / 30) - risk_free) / avg_vol if avg_vol else 0.0

    return {
        "totalReturn": round(avg_return * 100, 2),
        "volatility": round(avg_vol * 100, 2),
        "sharpe": round(sharpe, 2),
        "maxDrawdown": round((min(drawdowns) if drawdowns else 0.0) * 100, 2),
        "symbols": sorted(closes_by_symbol.keys()),
        "observations": observations,
    }


def claim_next_run(conn: psycopg.Connection) -> dict[str, object] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            WITH next_run AS (
              SELECT id
              FROM quant_runs
              WHERE status = 'queued'
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE quant_runs qr
            SET status = 'running',
                started_at = NOW(),
                error_message = NULL
            FROM next_run
            WHERE qr.id = next_run.id
            RETURNING qr.id, qr.strategy_name, qr.parameters
            """
        )
        return cur.fetchone()


def finish_run(
    conn: psycopg.Connection,
    run_id: str,
    status: str,
    metrics: dict[str, object] | None = None,
    error_message: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE quant_runs
            SET status = %s,
                metrics = %s::jsonb,
                error_message = %s,
                finished_at = NOW()
            WHERE id = %s
            """,
            (status, json.dumps(metrics) if metrics is not None else None, error_message, run_id),
        )


def run_once() -> dict[str, object]:
    with psycopg.connect(database_url(), autocommit=False) as conn:
        run = claim_next_run(conn)
        if not run:
            conn.commit()
            return {"status": "idle", "message": "No queued quant runs."}

        run_id = str(run["id"])
        try:
            parameters = run.get("parameters") or {}
            symbols = symbols_from_parameters(parameters)
            closes = fetch_market_closes(conn, symbols)
            metrics = calculate_metrics(closes)
            finish_run(conn, run_id, "succeeded", metrics=metrics)
            conn.commit()
            return {"status": "succeeded", "id": run_id, "metrics": metrics}
        except Exception as exc:
            finish_run(conn, run_id, "failed", error_message=str(exc))
            conn.commit()
            return {"status": "failed", "id": run_id, "error": str(exc)}


def main() -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] Quant worker booting")
    print(json.dumps(run_once(), indent=2))


if __name__ == "__main__":
    main()
