from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def load_local_env(path: str = ".env.local") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def default_payload(symbol: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "source": "local-automation",
        "kind": "investor_intelligence",
        "symbol": symbol.upper(),
        "status": "succeeded",
        "summary": f"Local investor intelligence refresh completed for {symbol.upper()}.",
        "parameters": {
            "adapters": ["last30days", "ai-berkshire", "kronos"],
            "mode": "local-deterministic-sample",
        },
        "startedAt": now,
        "finishedAt": now,
        "providerRuns": [
            {
                "provider": "local-automation",
                "status": "succeeded",
                "recordsFetched": 1,
                "startedAt": now,
                "finishedAt": now,
            }
        ],
        "insights": [
            {
                "title": f"{symbol.upper()} local research refresh",
                "summary": "Replace this sample with normalized output from last30days or another adapter.",
                "sentiment": "neutral",
                "confidence": 50,
                "catalyst": "Fresh research pending",
                "risk": "Adapter output not connected yet",
                "publishedAt": now,
            }
        ],
        "evidence": [
            {
                "sourceType": "worker",
                "sourceName": "local-automation",
                "title": "Local adapter placeholder",
                "excerpt": "This row proves the import path from worker to PostgreSQL-backed UI.",
                "engagement": 0,
                "observedAt": now,
            }
        ],
    }


def read_payload(path: str | None, symbol: str) -> dict[str, Any]:
    if not path:
        return default_payload(symbol)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Research payload must be a JSON object.")
    return data


def post_payload(api_base_url: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    token = os.getenv("QUANT_WORKER_API_TOKEN")
    if token:
        headers["x-worker-token"] = token

    request = Request(
        f"{api_base_url.rstrip('/')}/api/research/runs/import",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Research import failed: HTTP {exc.code} {detail}") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Import normalized investor intelligence JSON.")
    parser.add_argument("--payload", help="Path to normalized research JSON.")
    parser.add_argument("--symbol", default="BTC", help="Asset symbol for the sample payload.")
    parser.add_argument("--api-base-url", default=os.getenv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"))
    args = parser.parse_args()

    load_local_env()
    payload = read_payload(args.payload, args.symbol)
    result = post_payload(args.api_base_url, payload)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
