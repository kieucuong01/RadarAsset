from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from run_kronos_shadow import build_parser, run_shadow
from smart_insights.kronos.contracts import Bar, ForecastDistribution, ForecastPoint


def bars(count: int = 80) -> list[Bar]:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [Bar(start + timedelta(days=i), 100 + i, 102 + i, 99 + i, 101 + i, 1000) for i in range(count)]


class FakePredictor:
    def forecast(self, request):
        close = request.history[-1].close
        return ForecastDistribution(
            tuple(
                ForecastPoint(days, request.as_of + timedelta(days=days), close, close + days, close + 2 * days)
                for days in request.horizons
            ),
            request.seed,
            request.sample_count,
            request.temperature,
            request.top_p,
        )


class Repo:
    def __init__(self):
        self.success = []
        self.failure = []

    def load_btc_bars(self, as_of):
        return bars()

    def persist_success(self, **kwargs):
        self.success.append(kwargs)
        return "run-id"

    def persist_failure(self, **kwargs):
        self.failure.append(kwargs)


def test_parser_is_btc_only() -> None:
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--asset", "ETH", "--as-of", "2026-03-01T00:00:00Z"])


def test_dry_run_evaluates_without_writes() -> None:
    repo = Repo()
    outcome = run_shadow(
        repo,
        FakePredictor(),
        organization_id="org-id",
        as_of=bars()[-1].ts,
        evaluation_points=10,
        minimum_input_bars=30,
        dry_run=True,
        runtime_metadata={"device": "cpu"},
    )
    assert outcome.status == "ACCUMULATING"
    assert repo.success == [] and repo.failure == []


def test_success_persists_revisions_seed_parameters_and_input_fingerprint() -> None:
    repo = Repo()
    run_shadow(
        repo,
        FakePredictor(),
        organization_id="org-id",
        as_of=bars()[-1].ts,
        evaluation_points=10,
        minimum_input_bars=30,
        dry_run=False,
        runtime_metadata={"device": "cpu", "modelRevision": "model-rev", "manifestDigest": "digest"},
    )
    persisted = repo.success[0]
    assert persisted["config"]["seed"] == 20260814
    assert persisted["config"]["modelRevision"] == "model-rev"
    assert len(persisted["input_fingerprint"]) == 64
    assert repo.failure == []
