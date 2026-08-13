from datetime import date
from decimal import Decimal

from backtest.corporate_actions import (
    CorporateActionFetchResult,
    CorporateActionRecord,
    PostgresCorporateActionRepository,
)


def test_corporate_action_identity_is_stable_for_provider_event() -> None:
    first = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="event-123",
        action_type="cash_dividend",
        status="verified",
        ex_right_date=date(2026, 6, 1),
        cash_per_share=Decimal("1000"),
        source_payload={"id": "event-123", "value_per_share": 1000},
    )
    replay = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="event-123",
        action_type="cash_dividend",
        status="verified",
        ex_right_date=date(2026, 6, 1),
        cash_per_share=Decimal("1000"),
        source_payload={"value_per_share": 1000, "id": "event-123"},
    )

    assert first.identity_key == replay.identity_key
    assert first.checksum == replay.checksum


def test_corporate_action_checksum_changes_when_economic_terms_change() -> None:
    first = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="event-123",
        action_type="rights_issue",
        status="verified",
        ex_right_date=date(2026, 6, 1),
        subscription_ratio=Decimal("0.1"),
        subscription_price=Decimal("10000"),
        source_payload={"id": "event-123"},
    )
    corrected = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="event-123",
        action_type="rights_issue",
        status="verified",
        ex_right_date=date(2026, 6, 1),
        subscription_ratio=Decimal("0.1"),
        subscription_price=Decimal("12000"),
        source_payload={"id": "event-123"},
    )

    assert first.identity_key == corrected.identity_key
    assert first.checksum != corrected.checksum


def test_unknown_action_type_is_rejected_before_storage() -> None:
    try:
        CorporateActionRecord(
            asset="FPT",
            provider_code="vnstock-vci-free",
            provider_event_id="event-123",
            action_type="mystery",
            status="verified",
            ex_right_date=date(2026, 6, 1),
            source_payload={},
        )
    except ValueError as error:
        assert str(error) == "Unsupported corporate action type."
    else:
        raise AssertionError("Unknown corporate action type must be rejected.")


class FakeCursor:
    def __init__(self) -> None:
        self.queries: list[tuple[str, tuple[object, ...]]] = []
        self._fetchone = ("instrument-id", "asset-id")

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.queries.append((query, params))

    def fetchone(self):
        return self._fetchone

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class FakeTransaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_instance = FakeCursor()

    def transaction(self):
        return FakeTransaction()

    def cursor(self):
        return self.cursor_instance


def test_repository_upserts_action_and_records_complete_coverage() -> None:
    connection = FakeConnection()
    action = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="cash-1",
        action_type="cash_dividend",
        status="verified",
        ex_right_date=date(2025, 5, 20),
        cash_per_share=Decimal("1000"),
        source_payload={"id": "cash-1"},
    )
    result = CorporateActionFetchResult(
        asset="FPT",
        actions=(action,),
        complete=True,
        range_start=date(2016, 1, 1),
        range_end=date(2026, 1, 1),
    )

    stored = PostgresCorporateActionRepository(connection).save(result)

    assert stored == 1
    queries = [query for query, _params in connection.cursor_instance.queries]
    assert any("INSERT INTO corporate_actions" in query and "ON CONFLICT" in query for query in queries)
    assert any(
        "corporateActionCoverage" in str(params)
        for _query, params in connection.cursor_instance.queries
    )
