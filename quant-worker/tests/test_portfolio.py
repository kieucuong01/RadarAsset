from decimal import Decimal

import pytest

from backtest.engine import BacktestResult
from backtest.portfolio import PortfolioAssumptions, PortfolioLegInput, run_portfolio


def sleeve(symbol: str, points: list[tuple[str, str]], *, allocation_bps: int = 5000,
           market: str = "crypto_spot", adjustment_policy: str = "raw") -> PortfolioLegInput:
    equity = [
        {
            "timestamp": timestamp,
            "cash": 0.0,
            "marketValue": float(value),
            "grossExposure": float(value),
            "equity": float(value),
        }
        for timestamp, value in points
    ]
    result = BacktestResult(
        summary={"initialEquity": float(points[0][1]), "finalEquity": float(points[-1][1])},
        equity=equity,
        drawdown=[],
        trades=[],
        manifest={"strategyCode": "ma_crossover", "strategyVersion": "1.0.0"},
    )
    return PortfolioLegInput(
        id=f"leg-{symbol.lower()}",
        symbol=symbol,
        market=market,
        allocation_bps=allocation_bps,
        initial_notional=Decimal(points[0][1]),
        dataset_checksum=f"checksum-{symbol.lower()}",
        adjustment_policy=adjustment_policy,
        result=result,
    )


def assumptions(
    *,
    cash_bps: int = 0,
    rebalance: str = "none",
    monthly_contribution: str = "0",
    dividend_mode: str = "exclude",
    commission_bps: str = "0",
    sell_tax_bps: str = "0",
    slippage_bps: str = "0",
) -> PortfolioAssumptions:
    costs = {
        market: {
            "commissionBps": Decimal(commission_bps),
            "sellTaxBps": Decimal(sell_tax_bps),
            "slippageBps": Decimal(slippage_bps),
            "financingBpsAnnual": Decimal("0"),
        }
        for market in ("vn_equity", "crypto_spot", "metal_spot")
    }
    return PortfolioAssumptions(
        cash_allocation_bps=cash_bps,
        rebalance_frequency=rebalance,
        monthly_contribution=Decimal(monthly_contribution),
        dividend_mode=dividend_mode,
        fx_policy="normalized_returns",
        base_currency="USD",
        market_costs=costs,
    )


def test_cash_stays_flat_without_contributions_or_rebalancing() -> None:
    result = run_portfolio(
        [
            sleeve(
                "BTC",
                [("2024-01-01T00:00:00Z", "800"), ("2024-02-01T00:00:00Z", "880")],
                allocation_bps=8000,
            )
        ],
        total_capital=Decimal("1000"),
        assumptions=assumptions(cash_bps=2000),
        portfolio_hash="hash",
    )

    assert [row["cash"] for row in result.equity] == [200.0, 200.0]
    assert result.equity[-1]["equity"] == 1080.0
    assert result.contribution[-1]["components"] == {"BTC": 880.0, "cash": 200.0}


def test_monthly_contribution_is_applied_on_first_completed_timestamp_of_new_month() -> None:
    result = run_portfolio(
        [
            sleeve(
                "BTC",
                [
                    ("2024-01-31T00:00:00Z", "1000"),
                    ("2024-02-02T00:00:00Z", "1000"),
                    ("2024-02-03T00:00:00Z", "1100"),
                    ("2024-03-04T00:00:00Z", "1100"),
                ],
                allocation_bps=10000,
            )
        ],
        total_capital=Decimal("1000"),
        assumptions=assumptions(monthly_contribution="100"),
        portfolio_hash="hash",
    )

    assert [event["timestamp"] for event in result.cash_flow] == [
        "2024-02-02T00:00:00Z",
        "2024-03-04T00:00:00Z",
    ]
    assert [event["amount"] for event in result.cash_flow] == [100.0, 100.0]
    assert result.equity[-1]["equity"] == pytest.approx(1310.0)


@pytest.mark.parametrize(
    ("frequency", "expected"),
    [
        ("quarterly", ["2024-04-01T00:00:00Z", "2025-01-02T00:00:00Z"]),
        ("yearly", ["2025-01-02T00:00:00Z"]),
    ],
)
def test_rebalance_occurs_at_first_completed_timestamp_of_period(
    frequency: str, expected: list[str]
) -> None:
    timestamps = [
        "2024-01-02T00:00:00Z",
        "2024-04-01T00:00:00Z",
        "2025-01-02T00:00:00Z",
    ]
    result = run_portfolio(
        [
            sleeve("BTC", list(zip(timestamps, ["500", "600", "700"], strict=True))),
            sleeve("XAU", list(zip(timestamps, ["500", "500", "500"], strict=True)), market="metal_spot"),
        ],
        total_capital=Decimal("1000"),
        assumptions=assumptions(rebalance=frequency),
        portfolio_hash="hash",
    )

    assert [event["timestamp"] for event in result.rebalance] == expected


def test_rebalance_charges_cost_on_transferred_asset_notional() -> None:
    result = run_portfolio(
        [
            sleeve(
                "BTC",
                [("2024-01-01T00:00:00Z", "500"), ("2024-02-01T00:00:00Z", "1000")],
            ),
            sleeve(
                "XAU",
                [("2024-01-01T00:00:00Z", "500"), ("2024-02-01T00:00:00Z", "500")],
                market="metal_spot",
            ),
        ],
        total_capital=Decimal("1000"),
        assumptions=assumptions(rebalance="monthly", commission_bps="100"),
        portfolio_hash="hash",
    )

    event = result.rebalance[0]
    assert event["turnover"] == 500.0
    assert event["cost"] == 5.0
    assert result.equity[-1]["equity"] == 1495.0


def test_aggregation_never_uses_a_future_sleeve_value() -> None:
    result = run_portfolio(
        [
            sleeve(
                "BTC",
                [("2024-01-01T00:00:00Z", "500"), ("2024-01-03T00:00:00Z", "600")],
            ),
            sleeve(
                "XAU",
                [("2024-01-02T00:00:00Z", "500"), ("2024-01-03T00:00:00Z", "550")],
                market="metal_spot",
            ),
        ],
        total_capital=Decimal("1000"),
        assumptions=assumptions(),
        portfolio_hash="hash",
    )

    by_timestamp = {row["timestamp"]: row for row in result.equity}
    assert by_timestamp["2024-01-01T00:00:00Z"]["equity"] == 1000.0
    assert by_timestamp["2024-01-02T00:00:00Z"]["equity"] == 1000.0
    assert by_timestamp["2024-01-03T00:00:00Z"]["equity"] == 1150.0


def test_adjusted_dividend_mode_fails_when_a_leg_uses_raw_data() -> None:
    with pytest.raises(ValueError, match="adjusted"):
        run_portfolio(
            [
                sleeve(
                    "BTC",
                    [("2024-01-01T00:00:00Z", "1000")],
                    allocation_bps=10000,
                )
            ],
            total_capital=Decimal("1000"),
            assumptions=assumptions(dividend_mode="adjusted_prices"),
            portfolio_hash="hash",
        )
