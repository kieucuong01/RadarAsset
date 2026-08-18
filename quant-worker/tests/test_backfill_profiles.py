from datetime import date

import pytest

from backtest.backfill_profiles import resolve_backfill_profile


def test_vn_core_2018_profile_selects_the_source_available_history() -> None:
    profile = resolve_backfill_profile("vn-core-2018")

    assert profile.market == "vn_equity"
    assert profile.timeframe == "1d"
    assert profile.start == date(2018, 8, 20)
    assert profile.symbols == (
        "VNINDEX",
        "VN30",
        "FPT",
        "VCB",
        "HPG",
        "VNM",
        "MWG",
        "SSI",
        "VIC",
    )


def test_unknown_backfill_profile_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported backfill profile"):
        resolve_backfill_profile("all-hose-now")


def test_retired_2016_profile_is_rejected_instead_of_promising_unavailable_history() -> None:
    with pytest.raises(ValueError, match="Unsupported backfill profile"):
        resolve_backfill_profile("vn-core-2016")
