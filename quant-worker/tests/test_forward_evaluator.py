from datetime import datetime, timezone
from decimal import Decimal

from backtest.forward_evaluator import EvaluationWork, process_next_evaluation
from backtest.models import Bar
from backtest.quality import canonical_bar_checksum


def bar(day: int, open_price: str, close: str) -> Bar:
    return Bar(
        asset="BTC",
        timestamp=datetime(2026, 8, day, tzinfo=timezone.utc),
        timeframe="1d",
        open=Decimal(open_price),
        high=max(Decimal(open_price), Decimal(close)),
        low=min(Decimal(open_price), Decimal(close)),
        close=Decimal(close),
        volume=Decimal("1"),
        source="test",
    )


def work(rule: dict[str, object], rows: list[Bar]) -> EvaluationWork:
    return EvaluationWork(
        job_id="job-a",
        organization_id="org-a",
        assignment_id="assignment-a",
        portfolio_id="portfolio-a",
        owner_user_id="user-a",
        asset_id="asset-btc",
        symbol="BTC",
        strategy_version_id="strategy-v1",
        implementation_hash="",
        parameters=rule,
        dataset_version_id="dataset-v2",
        dataset_checksum=canonical_bar_checksum(rows),
        last_evaluated_bar_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        state={
            "simulatedCash": 1000,
            "simulatedQuantity": 0,
            "cumulativeContributions": 0,
            "cumulativeFees": 0,
            "startingEquity": 1000,
            "benchmarkQuantity": 10,
        },
        bars=rows,
        fee_bps=Decimal("0"),
        sell_tax_bps=Decimal("0"),
        slippage_bps=Decimal("0"),
    )


class FakeRepository:
    def __init__(self, item: EvaluationWork | None) -> None:
        self.item = item
        self.completed = None
        self.failed = None

    def claim_next_evaluation(self) -> EvaluationWork | None:
        item, self.item = self.item, None
        return item

    def complete_evaluation(self, item, outcome) -> None:
        self.completed = (item, outcome)

    def fail_evaluation(self, item, code: str) -> None:
        self.failed = (item.job_id, code)


def test_price_crossing_emits_close_signal_and_defers_fill() -> None:
    item = work(
        {
            "schemaVersion": 1,
            "kind": "price_threshold",
            "operator": "crosses_above",
            "threshold": 100,
            "currency": "USD",
            "action": "buy",
            "sizePct": 25,
        },
        [bar(1, "99", "99"), bar(2, "100", "101")],
    )
    item = EvaluationWork(**{**item.__dict__, "implementation_hash": item.rule_hash})
    repository = FakeRepository(item)

    response = process_next_evaluation(repository)

    assert response == {"status": "succeeded", "id": "job-a", "signalCount": 1}
    outcome = repository.completed[1]
    assert outcome.signals[0].event_type == "PRICE_CROSS"
    assert outcome.signals[0].signal_at == datetime(2026, 8, 2, tzinfo=timezone.utc)
    assert outcome.signals[0].metadata["executionStatus"] == "pending_next_bar_open"
    assert outcome.state["simulatedQuantity"] == 0
    assert outcome.state["pendingAction"]["action"] == "buy"


def test_price_pending_action_fills_on_next_published_bar_without_second_signal() -> None:
    item = work(
        {
            "schemaVersion": 1,
            "kind": "price_threshold",
            "operator": "crosses_above",
            "threshold": 100,
            "currency": "USD",
            "action": "buy",
            "sizePct": 25,
        },
        [bar(2, "100", "101"), bar(3, "102", "103")],
    )
    state = {**item.state, "pendingAction": {"action": "buy", "sizePct": 25, "signalAt": "2026-08-02T00:00:00Z"}}
    item = EvaluationWork(**{**item.__dict__, "last_evaluated_bar_at": datetime(2026, 8, 2, tzinfo=timezone.utc), "state": state, "implementation_hash": item.rule_hash})
    repository = FakeRepository(item)

    process_next_evaluation(repository)

    outcome = repository.completed[1]
    assert outcome.signals == ()
    assert outcome.state["simulatedQuantity"] > 0
    assert "pendingAction" not in outcome.state


def test_dca_emits_once_per_month_and_retry_is_idle() -> None:
    item = work(
        {
            "schemaVersion": 1,
            "kind": "scheduled_dca",
            "contributionAmount": 400,
            "currency": "USD",
            "frequency": "monthly",
            "dayOfMonth": 2,
        },
        [bar(1, "100", "100"), bar(2, "100", "100"), bar(3, "100", "100")],
    )
    item = EvaluationWork(**{**item.__dict__, "implementation_hash": item.rule_hash})
    repository = FakeRepository(item)
    process_next_evaluation(repository)
    outcome = repository.completed[1]

    assert len(outcome.signals) == 1
    assert outcome.signals[0].event_type == "SCHEDULED_DCA"
    assert outcome.state["paidMonths"] == ["2026-08"]
    assert outcome.state["cumulativeContributions"] == 400

    retry = EvaluationWork(**{**item.__dict__, "state": outcome.state, "last_evaluated_bar_at": datetime(2026, 8, 3, tzinfo=timezone.utc)})
    retry_repo = FakeRepository(retry)
    process_next_evaluation(retry_repo)
    assert retry_repo.completed[1].signals == ()


def test_hash_mismatch_fails_with_sanitized_code() -> None:
    item = work(
        {"schemaVersion": 1, "kind": "price_threshold", "operator": "crosses_above", "threshold": 100, "currency": "USD", "action": "buy", "sizePct": 25},
        [bar(1, "99", "99"), bar(2, "100", "101")],
    )
    repository = FakeRepository(item)
    assert process_next_evaluation(repository)["code"] == "STRATEGY_HASH_MISMATCH"
    assert repository.failed == ("job-a", "STRATEGY_HASH_MISMATCH")
