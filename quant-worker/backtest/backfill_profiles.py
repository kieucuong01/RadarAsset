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


VN_CORE_2016 = BackfillProfile(
    name="vn-core-2016",
    market="vn_equity",
    timeframe="1d",
    start=date(2016, 1, 1),
    symbols=("VNINDEX", "VN30", "FPT", "VCB", "HPG", "VNM", "MWG", "SSI", "VIC"),
)

_PROFILES = {VN_CORE_2016.name: VN_CORE_2016}


def resolve_backfill_profile(name: str) -> BackfillProfile:
    try:
        return _PROFILES[name]
    except KeyError as error:
        raise ValueError("Unsupported backfill profile.") from error
