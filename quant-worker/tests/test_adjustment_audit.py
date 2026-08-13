from datetime import date
from decimal import Decimal

from backtest.adjustment_audit import (
    audit_adjusted_observation,
    independent_event_factors,
    select_audit_basket,
)
from backtest.corporate_actions import CorporateActionRecord
from audit_vn_adjustments import build_audit_report


def action(action_type: str, **values) -> CorporateActionRecord:
    return CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id=values.pop("provider_event_id", action_type),
        action_type=action_type,
        status=values.pop("status", "verified"),
        ex_right_date=values.pop("ex_right_date", date(2025, 1, 3)),
        source_payload={},
        **values,
    )


def test_independent_factors_keep_cash_dividend_volume_unchanged() -> None:
    factors = independent_event_factors(
        Decimal("100"),
        [action("cash_dividend", cash_per_share=Decimal("10"))],
    )

    assert factors.price == Decimal("0.9")
    assert factors.quantity == Decimal("1")


def test_independent_factors_separate_rights_price_and_share_ratios() -> None:
    factors = independent_event_factors(
        Decimal("100"),
        [
            action("stock_dividend", distribution_ratio=Decimal("0.2")),
            action(
                "rights_issue",
                subscription_ratio=Decimal("0.1"),
                subscription_price=Decimal("50"),
            ),
        ],
    )

    assert factors.price.quantize(Decimal("0.00000001")) == Decimal("0.80769231")
    assert factors.quantity == Decimal("1.3")


def test_audit_compares_adjusted_price_and_volume_against_independent_formula() -> None:
    result = audit_adjusted_observation(
        raw_close=Decimal("100"),
        adjusted_close=Decimal("80.76923076923076923076923077"),
        raw_volume=Decimal("100"),
        adjusted_volume=Decimal("130"),
        actions=[
            action("stock_dividend", distribution_ratio=Decimal("0.2")),
            action(
                "rights_issue",
                subscription_ratio=Decimal("0.1"),
                subscription_price=Decimal("50"),
            ),
        ],
    )

    assert result == {"status": "passed", "priceDelta": "0E-26", "quantityDelta": "0.0"}


def test_basket_is_deterministic_and_covers_actions_inactive_and_unresolved() -> None:
    rows = [
        {"symbol": "ZZZ", "listingStatus": "active", "actionType": "cash_dividend", "status": "verified"},
        {"symbol": "AAA", "listingStatus": "inactive", "actionType": "stock_dividend", "status": "verified"},
        {"symbol": "BBB", "listingStatus": "active", "actionType": "rights_issue", "status": "unverified"},
        {"symbol": "CCC", "listingStatus": "active", "actionType": "split", "status": "verified"},
    ]

    assert select_audit_basket(rows) == [
        {"category": "cash_dividend", "symbol": "ZZZ"},
        {"category": "stock_dividend", "symbol": "AAA"},
        {"category": "split", "symbol": "CCC"},
        {"category": "rights_issue", "symbol": "BBB"},
        {"category": "inactive", "symbol": "AAA"},
        {"category": "unresolved", "symbol": "BBB"},
    ]


def test_db_report_fails_closed_when_adjusted_lineage_is_missing() -> None:
    report = build_audit_report(
        [
            {
                "symbol": "FPT",
                "listing_status": "active",
                "provider_event_id": "cash",
                "action_type": "cash_dividend",
                "status": "verified",
                "public_date": date(2025, 1, 1),
                "ex_right_date": date(2025, 1, 3),
                "record_date": None,
                "payment_date": None,
                "cash_per_share": Decimal("1000"),
                "distribution_ratio": None,
                "subscription_ratio": None,
                "subscription_price": None,
                "old_symbol": None,
                "new_symbol": None,
                "raw_version_id": "raw-1",
                "raw_checksum": "checksum-1",
                "adjusted_raw_version_id": None,
                "raw_close": Decimal("100"),
                "raw_volume": Decimal("100"),
                "adjusted_close": None,
                "adjusted_volume": None,
            }
        ]
    )

    assert report["status"] == "blocked"
    assert report["rawDataMutated"] is False
    assert report["lineageFailureCount"] == 1
