from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class BackfillProfile:
    name: str
    market: str
    timeframe: str
    start: date
    symbols: tuple[str, ...]


VN_CORE_2018 = BackfillProfile(
    name="vn-core-2018",
    market="vn_equity",
    timeframe="1d",
    start=date(2018, 8, 20),
    symbols=("VNINDEX", "VN30", "FPT", "VCB", "HPG", "VNM", "MWG", "SSI", "VIC"),
)

_PROFILES = {VN_CORE_2018.name: VN_CORE_2018}


def resolve_backfill_profile(name: str) -> BackfillProfile:
    try:
        return _PROFILES[name]
    except KeyError as error:
        raise ValueError("Unsupported backfill profile.") from error
