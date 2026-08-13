from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_forward_repository_selects_costs_for_the_assignment_market() -> None:
    source = (ROOT / "backtest" / "forward_evaluator.py").read_text(encoding="utf-8")

    assert "asset.market" in source
    assert 'costs.get(str(row["market"]), {})' in source
    assert "next(iter(costs.values())" not in source
