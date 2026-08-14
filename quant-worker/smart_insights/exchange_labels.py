from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re
from types import MappingProxyType
from urllib.parse import urlsplit
from collections.abc import Mapping


_ADDRESS = re.compile(r"^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{20,80})$")
_CONFIDENCE = frozenset({"verified", "reviewed", "heuristic"})


@dataclass(frozen=True, slots=True)
class ExchangeLabel:
    address: str
    entity_name: str
    entity_type: str
    source_url: str
    reviewed_at: date
    registry_version: str
    confidence: str

    def __post_init__(self) -> None:
        parsed = urlsplit(self.source_url)
        if _ADDRESS.fullmatch(self.address) is None:
            raise ValueError("Exchange label address is invalid.")
        if self.entity_type != "exchange":
            raise ValueError("Only exchange labels are supported.")
        if self.confidence not in _CONFIDENCE:
            raise ValueError("Exchange label confidence is invalid.")
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Exchange label evidence must use HTTPS.")
        if not self.entity_name.strip() or not self.registry_version.strip():
            raise ValueError("Exchange label metadata is required.")


_EXCHANGE_LABELS: tuple[ExchangeLabel, ...] = ()
_BY_ADDRESS = MappingProxyType({row.address: row for row in _EXCHANGE_LABELS})


def exchange_labels_by_address() -> Mapping[str, ExchangeLabel]:
    return _BY_ADDRESS


def reviewed_exchange(address: str) -> ExchangeLabel | None:
    label = _BY_ADDRESS.get(address)
    if label is None or label.confidence not in {"verified", "reviewed"}:
        return None
    return label
