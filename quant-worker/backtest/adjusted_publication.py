from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from .adjustments import adjust_total_return_bars
from .adjustments import AdjustmentUnavailable
from .corporate_actions import CorporateActionRecord
from .market_calendar import HOSE_CALENDAR_VERSION
from .publication import PreparedDatasetPublication, prepare_dataset_publication


def build_adjusted_publication(
    raw: PreparedDatasetPublication,
    *,
    raw_dataset_version_id: str,
    actions: Iterable[CorporateActionRecord],
    corporate_action_coverage_complete: bool,
) -> PreparedDatasetPublication:
    action_rows = list(actions)
    coverage_start = raw.coverage_start.date()
    coverage_end = raw.coverage_end.date()
    unsafe_actions = []
    for action in action_rows:
        if action.status == "verified" or action.action_type == "symbol_change":
            continue
        if action.ex_right_date is None:
            unsafe = action.public_date is None or action.public_date <= coverage_end
        else:
            unsafe = coverage_start <= action.ex_right_date <= coverage_end
        if unsafe:
            unsafe_actions.append(action)
    if unsafe_actions:
        raise AdjustmentUnavailable(
            "Corporate action coverage contains unverified price-affecting events."
        )
    result = adjust_total_return_bars(
        raw.rows,
        action_rows,
        coverage_complete=corporate_action_coverage_complete,
        cash_value_scale=(
            Decimal("1000")
            if raw.market == "vn_equity" and raw.provider_code == "vnstock-vci-free"
            else Decimal("1")
        ),
    )
    metadata = {
        **raw.source_metadata,
        "adjustmentPolicy": "total_return",
        "rawDatasetVersionId": raw_dataset_version_id,
        "corporateActionChecksums": sorted(
            action.checksum for action in action_rows if action.status == "verified"
        ),
        "corporateActionCoverageComplete": corporate_action_coverage_complete,
        "calendarVersion": HOSE_CALENDAR_VERSION,
        "timezone": "Asia/Ho_Chi_Minh",
        "priceUnit": "thousand_vnd" if raw.market == "vn_equity" else raw.currency,
        "corporateActionCashUnit": raw.currency,
        "cashValueScaleToPriceUnit": 1000 if raw.market == "vn_equity" else 1,
        "appliedEventCount": result.applied_event_count,
        "skippedUnverifiedEventCount": result.skipped_unverified,
    }
    return prepare_dataset_publication(
        list(result.rows),
        market=raw.market,
        provider_code=raw.provider_code,
        provider_name=raw.provider_name,
        provider_symbol=raw.provider_symbol,
        canonical_key=raw.canonical_key,
        asset_name=raw.asset_name,
        currency=raw.currency,
        venue=raw.venue,
        timezone_name=raw.timezone_name,
        maximum_leverage=raw.maximum_leverage,
        terms_url=raw.terms_url,
        source_metadata=metadata,
        adjustment_policy="total_return",
    )
