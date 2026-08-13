from datetime import date
from decimal import Decimal

from backtest.adjusted_publication import build_adjusted_publication
from backtest.corporate_actions import CorporateActionRecord
from backtest.publication import prepare_dataset_publication
from test_adjustments import daily


def test_adjusted_publication_links_raw_manifest_actions_and_calendar() -> None:
    raw = prepare_dataset_publication(
        [daily(2, "100"), daily(3, "90")],
        market="vn_equity",
        provider_code="vnstock-vci-free",
        provider_name="Vnstock VCI Free",
        provider_symbol="FPT",
        canonical_key="vn_equity:HOSE:FPT",
        asset_name="FPT Corporation",
        currency="VND",
        venue="HOSE",
        timezone_name="Asia/Ho_Chi_Minh",
        maximum_leverage=Decimal("2"),
        terms_url="https://vnstocks.com/docs/vnstock",
        source_metadata={"mode": "live"},
    )
    action = CorporateActionRecord(
        asset="FPT",
        provider_code="vnstock-vci-free",
        provider_event_id="cash-1",
        action_type="cash_dividend",
        status="verified",
        ex_right_date=date(2025, 1, 3),
        cash_per_share=Decimal("10000"),
        source_payload={},
    )

    adjusted = build_adjusted_publication(
        raw,
        raw_dataset_version_id="raw-version-1",
        actions=[action],
        corporate_action_coverage_complete=True,
    )

    assert adjusted.adjustment_policy == "total_return"
    assert adjusted.rows[0].close == Decimal("90.00000000")
    assert adjusted.source_metadata["rawDatasetVersionId"] == "raw-version-1"
    assert adjusted.source_metadata["corporateActionChecksums"] == [action.checksum]
    assert adjusted.source_metadata["calendarVersion"] == "hose-official-closures-2024-2026-v1"
