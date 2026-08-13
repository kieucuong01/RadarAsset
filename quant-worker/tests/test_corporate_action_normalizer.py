from datetime import date
from decimal import Decimal

from backtest.corporate_actions import VciCorporateActionAdapter, normalize_vci_event


def test_normalizes_verified_cash_dividend() -> None:
    action = normalize_vci_event(
        "FPT",
        {
            "id": "cash-1",
            "event_code": "DIV",
            "event_title": "Chi trả cổ tức bằng tiền mặt",
            "public_date": "2026-05-01",
            "exright_date": "2026-05-20",
            "record_date": "2026-05-21",
            "payout_date": "2026-06-01",
            "value_per_share": 1000,
        },
    )

    assert action is not None
    assert action.action_type == "cash_dividend"
    assert action.status == "verified"
    assert action.ex_right_date == date(2026, 5, 20)
    assert action.cash_per_share == Decimal("1000")


def test_normalizes_stock_dividend_ratio() -> None:
    action = normalize_vci_event(
        "FPT",
        {
            "id": "stock-1",
            "event_code": "ISS",
            "event_name_vi": "Cổ tức bằng cổ phiếu",
            "event_title": "Tỷ lệ thực hiện 20%",
            "exright_date": "2026-07-01",
            "exercise_ratio": 0.2,
        },
    )

    assert action is not None
    assert action.action_type == "stock_dividend"
    assert action.status == "verified"
    assert action.distribution_ratio == Decimal("0.2")


def test_rights_issue_without_ex_date_is_retained_but_not_verified() -> None:
    action = normalize_vci_event(
        "FPT",
        {
            "id": "rights-1",
            "event_code": "ISS",
            "event_title": "Quyền mua cổ phiếu phát hành thêm",
            "exercise_ratio": "0.1",
            "value_per_share": "10000",
        },
    )

    assert action is not None
    assert action.action_type == "rights_issue"
    assert action.status == "unverified"
    assert action.subscription_ratio == Decimal("0.1")
    assert action.subscription_price == Decimal("10000")


def test_irrelevant_company_event_is_not_stored_as_corporate_action() -> None:
    assert (
        normalize_vci_event(
            "FPT",
            {"id": "meeting-1", "event_code": "AGME", "event_title": "Đại hội cổ đông"},
        )
        is None
    )


class FakeVciProvider:
    def __init__(self) -> None:
        self.pages: list[int] = []

    def _fetch_events(self, **kwargs):
        self.pages.append(kwargs["page"])
        if kwargs["page"] == 0:
            return [
                {
                    "id": "cash-1",
                    "event_code": "DIV",
                    "event_title": "Cash dividend",
                    "exright_date": "2024-01-10",
                    "value_per_share": 500,
                },
                {"id": "meeting", "event_code": "AGME", "event_title": "Meeting"},
            ]
        return []


class FakeVciCompany:
    def __init__(self) -> None:
        self.provider = FakeVciProvider()


def test_vci_adapter_paginates_and_keeps_only_price_affecting_events() -> None:
    company = FakeVciCompany()
    adapter = VciCorporateActionAdapter(company_factory=lambda _symbol: company, page_size=2)

    result = adapter.fetch("FPT", start=date(2020, 1, 1), end=date(2026, 1, 1))

    assert result.complete is True
    assert [action.provider_event_id for action in result.actions] == ["cash-1"]
    assert company.provider.pages == [0, 1]
