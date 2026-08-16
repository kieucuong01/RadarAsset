from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[1]


def test_worker_entrypoint_has_only_composition_responsibilities() -> None:
    source = (WORKER_ROOT / "worker.py").read_text(encoding="utf-8")

    assert len(source.splitlines()) <= 180
    assert "SELECT " not in source
    assert "UPDATE " not in source


def test_worker_modules_follow_one_way_dependency_boundaries() -> None:
    execution = (WORKER_ROOT / "backtest" / "run_execution.py").read_text(encoding="utf-8")
    repository = (WORKER_ROOT / "backtest" / "run_repository.py").read_text(encoding="utf-8")

    assert "import psycopg" not in execution
    assert "import os" not in execution
    assert "from backtest.engine" not in repository
    assert "from backtest.analytics" not in repository
    assert "from backtest.strategies" not in repository
