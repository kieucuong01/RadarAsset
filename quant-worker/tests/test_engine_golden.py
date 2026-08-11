import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from backtest.engine import EngineConfig, artifact_checksum, run_ma_cross
from backtest.models import Bar
from backtest.strategies import MovingAverageCrossoverStrategy


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "ma_cross_golden.json"


def load_fixture() -> tuple[dict[str, list[Bar]], dict[str, str]]:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    asset = payload["asset"]
    bars = [
        Bar(
            asset=asset,
            timestamp=datetime.fromisoformat(row["ts"].replace("Z", "+00:00")),
            timeframe=payload["timeframe"],
            open=Decimal(row["open"]),
            high=Decimal(row["high"]),
            low=Decimal(row["low"]),
            close=Decimal(row["close"]),
            volume=Decimal(row["volume"]),
            source="golden-fixture",
        )
        for row in payload["bars"]
    ]
    return {asset: bars}, {asset: payload["market"]}


def base_config(**overrides: object) -> EngineConfig:
    values: dict[str, object] = {
        "initial_capital": Decimal("1000"),
        "fast_period": 2,
        "slow_period": 3,
        "fee_bps": Decimal("100"),
        "slippage_bps": Decimal("100"),
        "leverage_by_asset": {"BTC": Decimal("1")},
        "market_by_asset": {"BTC": "crypto_spot"},
        "strategy_hash": "golden-strategy",
        "dataset_checksums": {"BTC": "golden-dataset"},
    }
    values.update(overrides)
    return EngineConfig(**values)


def test_golden_next_open_fills_costs_pnl_and_drawdown() -> None:
    bars_by_asset, _markets = load_fixture()

    result = run_ma_cross(bars_by_asset, base_config())

    assert result.summary == {
        "initialEquity": 1000.0,
        "finalEquity": 517.34746971,
        "totalReturnPct": -48.26525303,
        "maxDrawdownPct": -48.26525303,
        "tradeCount": 1,
        "winRatePct": 0.0,
        "profitFactor": 0.0,
        "totalFees": 15.12672212,
        "slippageCost": 15.08147768,
    }
    assert result.trades == [
        {
            "asset": "BTC",
            "side": "long",
            "entrySignalAt": "2024-01-05T00:00:00Z",
            "entryAt": "2024-01-08T00:00:00Z",
            "exitSignalAt": "2024-01-09T00:00:00Z",
            "exitAt": "2024-01-10T00:00:00Z",
            "entryPrice": 13.13,
            "exitPrice": 6.93,
            "quantity": 75.40738842,
            "fees": 15.12672212,
            "slippageCost": 15.08147768,
            "realizedPnl": -482.65253029,
            "returnPct": -48.26525303,
            "barsHeld": 2,
            "exitReason": "signal",
        }
    ]
    assert result.trades[0]["entryAt"] != result.trades[0]["entrySignalAt"]
    assert result.trades[0]["exitAt"] != result.trades[0]["exitSignalAt"]
    assert result.equity[-1]["equity"] == 517.34746971
    assert result.drawdown[-1]["drawdownPct"] == -48.26525303


def test_engine_is_deterministic_and_artifact_checksums_are_stable() -> None:
    bars_by_asset, _markets = load_fixture()

    first = run_ma_cross(bars_by_asset, base_config())
    second = run_ma_cross(bars_by_asset, base_config())

    assert first == second
    assert artifact_checksum(first.equity) == artifact_checksum(second.equity)
    assert artifact_checksum(first.trades) == artifact_checksum(second.trades)


def test_engine_uses_shared_ma_strategy_without_changing_golden_output() -> None:
    bars_by_asset, _markets = load_fixture()

    inline_strategy = run_ma_cross(
        bars_by_asset,
        base_config(strategy=MovingAverageCrossoverStrategy(fast_period=2, slow_period=3)),
    )
    legacy_defaults = run_ma_cross(bars_by_asset, base_config())

    assert inline_strategy == legacy_defaults


@pytest.mark.parametrize(
    ("asset", "market", "leverage", "maximum"),
    [
        ("BTC", "crypto_spot", "1.01", "1"),
        ("XAU", "metal_spot", "1.01", "1"),
        ("FPT", "vn_equity", "2.01", "2"),
    ],
)
def test_engine_rejects_leverage_above_product_limits(
    asset: str, market: str, leverage: str, maximum: str
) -> None:
    bars_by_asset, _markets = load_fixture()
    bars_by_asset = {asset: [Bar(**{**row.__dict__, "asset": asset}) for row in bars_by_asset["BTC"]]}
    config = base_config(
        leverage_by_asset={asset: Decimal(leverage)},
        market_by_asset={asset: market},
        dataset_checksums={asset: "fixture"},
    )

    with pytest.raises(ValueError, match=f"maximum is {maximum}x"):
        run_ma_cross(bars_by_asset, config)


def test_engine_never_emits_short_or_negative_positions() -> None:
    bars_by_asset, _markets = load_fixture()

    result = run_ma_cross(bars_by_asset, base_config())

    assert all(trade["side"] == "long" for trade in result.trades)
    assert all(trade["quantity"] > 0 for trade in result.trades)
    assert all(point["grossExposure"] >= 0 for point in result.equity)


def test_profit_factor_is_null_when_a_run_has_winners_but_no_losses() -> None:
    closes = ["10", "9", "8", "9", "10", "11", "12", "13", "12", "11", "10"]
    bars: list[Bar] = []
    previous_close = Decimal(closes[0])
    for index, close_text in enumerate(closes):
        close = Decimal(close_text)
        bars.append(
            Bar(
                asset="BTC",
                timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc)
                + timedelta(days=index),
                timeframe="1d",
                open=previous_close,
                high=max(previous_close, close) + Decimal("1"),
                low=min(previous_close, close) - Decimal("1"),
                close=close,
                volume=Decimal("100"),
                source="profit-factor-fixture",
            )
        )
        previous_close = close

    result = run_ma_cross(
        {"BTC": bars},
        base_config(fee_bps=Decimal("0"), slippage_bps=Decimal("0")),
    )

    assert result.summary["tradeCount"] == 1
    assert result.trades[0]["realizedPnl"] > 0
    assert result.summary["profitFactor"] is None
