from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal


CorporateActionType = Literal[
    "cash_dividend",
    "stock_dividend",
    "split",
    "rights_issue",
    "symbol_change",
]
CorporateActionStatus = Literal["verified", "unverified", "rejected"]

_ACTION_TYPES = {
    "cash_dividend",
    "stock_dividend",
    "split",
    "rights_issue",
    "symbol_change",
}
_STATUSES = {"verified", "unverified", "rejected"}


def _decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else format(value.normalize(), "f")


def _date_value(value: Any) -> date | None:
    if value is None or str(value).strip().lower() in {"", "nan", "nat", "none"}:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def _decimal_value(value: Any) -> Decimal | None:
    if value is None or str(value).strip().lower() in {"", "nan", "nat", "none"}:
        return None
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except (ArithmeticError, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _search_text(record: dict[str, Any]) -> str:
    raw = " ".join(
        str(record.get(key, ""))
        for key in ("event_code", "event_name_vi", "event_name_en", "event_title", "category")
    ).lower()
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", raw)
        if not unicodedata.combining(character)
    )


def _snake_case_key(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


def _snake_case_record(record: dict[str, Any]) -> dict[str, Any]:
    return {_snake_case_key(str(key)): value for key, value in record.items()}


@dataclass(frozen=True)
class CorporateActionRecord:
    asset: str
    provider_code: str
    provider_event_id: str
    action_type: CorporateActionType | str
    status: CorporateActionStatus | str
    ex_right_date: date | None
    source_payload: dict[str, Any]
    public_date: date | None = None
    record_date: date | None = None
    payment_date: date | None = None
    cash_per_share: Decimal | None = None
    distribution_ratio: Decimal | None = None
    subscription_ratio: Decimal | None = None
    subscription_price: Decimal | None = None
    old_symbol: str | None = None
    new_symbol: str | None = None

    def __post_init__(self) -> None:
        if self.action_type not in _ACTION_TYPES:
            raise ValueError("Unsupported corporate action type.")
        if self.status not in _STATUSES:
            raise ValueError("Unsupported corporate action status.")
        if not re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", self.asset):
            raise ValueError("Corporate action asset is invalid.")
        if not self.provider_code.strip() or not self.provider_event_id.strip():
            raise ValueError("Corporate action provider identity is required.")

    @property
    def identity_key(self) -> str:
        return f"{self.provider_code}:{self.provider_event_id}"

    @property
    def checksum(self) -> str:
        payload = {
            "asset": self.asset,
            "providerCode": self.provider_code,
            "providerEventId": self.provider_event_id,
            "actionType": self.action_type,
            "status": self.status,
            "exRightDate": self.ex_right_date.isoformat() if self.ex_right_date else None,
            "publicDate": self.public_date.isoformat() if self.public_date else None,
            "recordDate": self.record_date.isoformat() if self.record_date else None,
            "paymentDate": self.payment_date.isoformat() if self.payment_date else None,
            "cashPerShare": _decimal_text(self.cash_per_share),
            "distributionRatio": _decimal_text(self.distribution_ratio),
            "subscriptionRatio": _decimal_text(self.subscription_ratio),
            "subscriptionPrice": _decimal_text(self.subscription_price),
            "oldSymbol": self.old_symbol,
            "newSymbol": self.new_symbol,
            "sourcePayload": self.source_payload,
        }
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


def normalize_vci_event(asset: str, event: dict[str, Any]) -> CorporateActionRecord | None:
    """Normalize only price-affecting VCI events; preserve incomplete ones as unverified."""
    text = _search_text(event)
    event_code = str(event.get("event_code", "")).upper()
    event_id = str(event.get("id") or event.get("event_id") or "").strip()
    if not event_id:
        return None

    ratio = _decimal_value(event.get("exercise_ratio"))
    value = _decimal_value(event.get("value_per_share"))
    action_type: CorporateActionType | None = None
    cash_per_share: Decimal | None = None
    distribution_ratio: Decimal | None = None
    subscription_ratio: Decimal | None = None
    subscription_price: Decimal | None = None

    if "quyen mua" in text or "rights issue" in text or "subscription" in text:
        action_type = "rights_issue"
        subscription_ratio = ratio
        subscription_price = value
    elif "tach co phieu" in text or "stock split" in text:
        action_type = "split"
        distribution_ratio = ratio
    elif (
        "co tuc bang co phieu" in text
        or "stock dividend" in text
        or "thuong co phieu" in text
        or "co phieu thuong" in text
        or "bonus issue" in text
    ):
        action_type = "stock_dividend"
        distribution_ratio = ratio
    elif event_code == "DIV" or "co tuc bang tien" in text or "cash dividend" in text:
        action_type = "cash_dividend"
        cash_per_share = value
    elif "doi ma" in text or "symbol change" in text:
        action_type = "symbol_change"
    elif event_code != "ISS":
        return None
    else:
        # An unclassified issuance must never silently affect adjusted prices.
        action_type = "rights_issue"
        subscription_ratio = ratio
        subscription_price = value

    ex_right_date = _date_value(event.get("exright_date"))
    has_terms = {
        "cash_dividend": cash_per_share is not None and cash_per_share > 0,
        "stock_dividend": distribution_ratio is not None and distribution_ratio > 0,
        "split": distribution_ratio is not None and distribution_ratio > 0,
        "rights_issue": (
            subscription_ratio is not None
            and subscription_ratio > 0
            and subscription_price is not None
            and subscription_price >= 0
        ),
        "symbol_change": bool(event.get("old_symbol") and event.get("new_symbol")),
    }[action_type]

    return CorporateActionRecord(
        asset=asset.strip().upper(),
        provider_code="vnstock-vci-free",
        provider_event_id=event_id,
        action_type=action_type,
        status="verified" if ex_right_date is not None and has_terms else "unverified",
        public_date=_date_value(event.get("public_date")),
        ex_right_date=ex_right_date,
        record_date=_date_value(event.get("record_date")),
        payment_date=_date_value(event.get("payout_date") or event.get("payment_date")),
        cash_per_share=cash_per_share,
        distribution_ratio=distribution_ratio,
        subscription_ratio=subscription_ratio,
        subscription_price=subscription_price,
        old_symbol=str(event.get("old_symbol") or "").strip().upper() or None,
        new_symbol=str(event.get("new_symbol") or "").strip().upper() or None,
        source_payload=event,
    )


@dataclass(frozen=True)
class CorporateActionFetchResult:
    asset: str
    actions: tuple[CorporateActionRecord, ...]
    complete: bool
    range_start: date
    range_end: date


def _default_vci_company_factory(symbol: str) -> Any:
    import vnai

    original_setup = vnai.async_setup_agent_environment
    vnai.async_setup_agent_environment = lambda *args, **kwargs: False
    try:
        from vnstock import Company
    finally:
        vnai.async_setup_agent_environment = original_setup
    return Company(source="VCI", symbol=symbol)


class VciCorporateActionAdapter:
    def __init__(
        self,
        *,
        company_factory: Callable[[str], Any] = _default_vci_company_factory,
        page_size: int = 50,
        max_pages: int = 100,
    ) -> None:
        if not 1 <= page_size <= 500 or not 1 <= max_pages <= 500:
            raise ValueError("Corporate action pagination limit is invalid.")
        self.company_factory = company_factory
        self.page_size = page_size
        self.max_pages = max_pages

    def fetch(self, asset: str, *, start: date, end: date) -> CorporateActionFetchResult:
        if start > end:
            raise ValueError("Corporate action range is invalid.")
        symbol = asset.strip().upper()
        company = self.company_factory(symbol)
        provider = getattr(company, "provider", company)
        fetch_page = getattr(provider, "_fetch_events", None)
        if not callable(fetch_page):
            raise RuntimeError("VCI corporate action pagination is unavailable.")

        actions: dict[str, CorporateActionRecord] = {}
        complete = False
        for page in range(self.max_pages):
            rows = fetch_page(
                event_codes="DIV,ISS,MOVE",
                from_date=start.strftime("%Y%m%d"),
                to_date=end.strftime("%Y%m%d"),
                page=page,
                size=self.page_size,
            )
            if not isinstance(rows, list):
                raise RuntimeError("VCI corporate action response is invalid.")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                action = normalize_vci_event(symbol, _snake_case_record(row))
                if action is not None:
                    actions[action.provider_event_id] = action
            if len(rows) < self.page_size:
                complete = True
                break

        ordered = tuple(
            sorted(
                actions.values(),
                key=lambda item: (item.ex_right_date or date.max, item.provider_event_id),
            )
        )
        return CorporateActionFetchResult(
            asset=symbol,
            actions=ordered,
            complete=complete,
            range_start=start,
            range_end=end,
        )


class PostgresCorporateActionRepository:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    def save(self, result: CorporateActionFetchResult) -> int:
        with self.connection.transaction():
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT instrument.id, asset.id
                    FROM provider_instruments AS instrument
                    JOIN data_providers AS provider ON provider.id = instrument.provider_id
                    JOIN assets AS asset ON asset.id = instrument.asset_id
                    WHERE provider.code = 'vnstock-vci-free'
                      AND asset.symbol = %s
                    LIMIT 1
                    """,
                    (result.asset,),
                )
                identity = cursor.fetchone()
                if identity is None:
                    raise RuntimeError("Corporate action instrument is not synchronized.")
                instrument_id, asset_id = identity
                for action in result.actions:
                    cursor.execute(
                        """
                        INSERT INTO corporate_actions (
                          id, asset_id, provider_instrument_id, provider_event_id,
                          action_type, status, public_date, ex_right_date, record_date,
                          payment_date, cash_per_share, distribution_ratio,
                          subscription_ratio, subscription_price, old_symbol, new_symbol,
                          checksum, source_payload, observed_at, updated_at
                        ) VALUES (
                          gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW(), NOW()
                        )
                        ON CONFLICT (provider_instrument_id, provider_event_id) DO UPDATE SET
                          action_type = EXCLUDED.action_type,
                          status = EXCLUDED.status,
                          public_date = EXCLUDED.public_date,
                          ex_right_date = EXCLUDED.ex_right_date,
                          record_date = EXCLUDED.record_date,
                          payment_date = EXCLUDED.payment_date,
                          cash_per_share = EXCLUDED.cash_per_share,
                          distribution_ratio = EXCLUDED.distribution_ratio,
                          subscription_ratio = EXCLUDED.subscription_ratio,
                          subscription_price = EXCLUDED.subscription_price,
                          old_symbol = EXCLUDED.old_symbol,
                          new_symbol = EXCLUDED.new_symbol,
                          checksum = EXCLUDED.checksum,
                          source_payload = EXCLUDED.source_payload,
                          observed_at = NOW(),
                          updated_at = NOW()
                        """,
                        (
                            asset_id,
                            instrument_id,
                            action.provider_event_id,
                            action.action_type,
                            action.status,
                            action.public_date,
                            action.ex_right_date,
                            action.record_date,
                            action.payment_date,
                            action.cash_per_share,
                            action.distribution_ratio,
                            action.subscription_ratio,
                            action.subscription_price,
                            action.old_symbol,
                            action.new_symbol,
                            action.checksum,
                            json.dumps(action.source_payload, ensure_ascii=False, default=str),
                        ),
                    )
                cursor.execute(
                    """
                    UPDATE provider_instruments
                    SET metadata = metadata || %s::jsonb,
                        last_seen_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        json.dumps(
                            {
                                "corporateActionCoverage": {
                                    "start": result.range_start.isoformat(),
                                    "end": result.range_end.isoformat(),
                                    "complete": result.complete,
                                    "eventCount": len(result.actions),
                                }
                            },
                            separators=(",", ":"),
                        ),
                        instrument_id,
                    ),
                )
        return len(result.actions)
