from datetime import datetime, timedelta, timezone
from decimal import Decimal
from inspect import getsource

from smart_insights.asset_opinion_contracts import (
    AssetCandidate,
    AssetOpinionAiOutput,
    AssetOpinionMarketData,
    MarketBar,
    QuantFact,
    UniverseResult,
)
from smart_insights.asset_opinion_pipeline import AssetOpinionBatch, build_asset_opinion_drafts
from smart_insights.briefing_pipeline import PostgresBriefingRepository, _persist_asset_opinion
from smart_insights.personalization import UserInsightPreference


NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)


class FakeCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.current: dict[str, object] | None = None

    def execute(self, query: str, parameters: object) -> None:
        self.calls.append((query, parameters))
        if "SELECT id FROM assets" in query:
            self.current = {"id": "11111111-1111-1111-1111-111111111111"}
        elif "INSERT INTO signal_snapshots" in query:
            self.current = {"id": "22222222-2222-2222-2222-222222222222"}
        else:
            self.current = None

    def fetchone(self) -> dict[str, object] | None:
        return self.current


class EmptySignalCursor:
    def __init__(self, connection: "EmptySignalConnection") -> None:
        self.connection = connection

    def __enter__(self) -> "EmptySignalCursor":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, parameters: object) -> None:
        self.connection.queries.append(query)

    def fetchall(self) -> list[dict[str, object]]:
        return []


class EmptySignalConnection:
    autocommit = True

    def __init__(self) -> None:
        self.queries: list[str] = []

    def cursor(self, **kwargs: object) -> EmptySignalCursor:
        return EmptySignalCursor(self)


def draft(asset_market: str = "crypto", bar_count: int = 80):
    asset = AssetCandidate("BTC", "Bitcoin", asset_market, Decimal("0.18"), 0)
    bars = tuple(
        MarketBar(
            f"bar-{index}",
            "BTC",
            NOW - timedelta(days=79 - index),
            Decimal(100 + index),
            NOW - timedelta(days=79 - index),
        )
        for index in range(bar_count)
    )
    fact = QuantFact(
        "etf-flow",
        "crypto.etf.net_flow_usd",
        Decimal("1"),
        "RATIO",
        NOW,
        NOW,
        "farside",
        "farside",
        "https://farside.co.uk",
        Decimal("60"),
        Decimal("80"),
        True,
        False,
        "asset-opinion-facts-v1",
    )

    def synthesizer(bundle, **kwargs):
        return AssetOpinionAiOutput(
            "Xu hướng định lượng được xác nhận.",
            "Dòng tiền tiếp tục hỗ trợ.",
            "Theo dõi thêm xác nhận.",
            "Luận điểm yếu đi khi dòng tiền đảo chiều.",
            ("Dòng tiền không còn hiệu lực.",),
            bundle.supporting_evidence_ids,
            bundle.contradicting_evidence_ids,
            ("BTC",),
            "WEEKS_1_4",
            kwargs["deterministic_action"],
            50,
        )

    return build_asset_opinion_drafts(
        AssetOpinionBatch(
            UniverseResult((asset,), ()),
            AssetOpinionMarketData((("BTC", bars),), (("BTC", (fact,)),)),
            UserInsightPreference(),
            NOW,
            "organization",
        ),
        synthesizer=synthesizer,
    )[0]


def test_persistence_writes_existing_models_and_exactly_one_asset() -> None:
    cursor = FakeCursor()
    opinion = draft()

    snapshot = _persist_asset_opinion(
        cursor,
        opinion=opinion,
        organization_id="organization",
        user_id="user",
        run_id="33333333-3333-3333-3333-333333333333",
        as_of=NOW,
        risk_tolerance="moderate",
    )

    sql = "\n".join(query for query, _ in cursor.calls)
    assert "INSERT INTO signal_snapshots" in sql
    assert "INSERT INTO evidence_items" in sql
    assert "INSERT INTO ai_insights" in sql
    assert "deepseek-chat-completions" in sql
    assert "INSERT INTO daily_briefing_items" not in sql
    assert "INSERT INTO research_runs" not in sql
    assert "SELECT id FROM signal_snapshots" not in sql
    assert snapshot["symbol"] == "BTC"
    assert snapshot["explanationStatus"] == "accepted"
    assert snapshot["evidence"][0]["sourceCode"] == "farside"
    assert snapshot["riskTolerance"] == "moderate"
    assert snapshot["unrealizedReturn"] is None
    assert "kronos" not in str(snapshot).casefold()


def test_signal_loader_does_not_reconsume_asset_opinion_snapshots() -> None:
    connection = EmptySignalConnection()
    repository = PostgresBriefingRepository(connection)  # type: ignore[arg-type]

    assert repository.load_briefing_signals("organization", "user", as_of=NOW) == ()
    assert "s.signal_type <> 'asset_opinion'" in connection.queries[0]


def test_persistence_maps_non_smart_insights_markets_to_macro() -> None:
    cursor = FakeCursor()

    _persist_asset_opinion(
        cursor,
        opinion=draft("equity"),
        organization_id="organization",
        user_id="user",
        run_id="33333333-3333-3333-3333-333333333333",
        as_of=NOW,
        risk_tolerance="moderate",
    )

    signal_insert = next(
        parameters
        for query, parameters in cursor.calls
        if "INSERT INTO signal_snapshots" in query
    )
    assert isinstance(signal_insert, tuple)
    assert signal_insert[1] == "macro"


def test_insufficient_opinion_uses_allowed_unavailable_snapshot_status() -> None:
    cursor = FakeCursor()

    _persist_asset_opinion(
        cursor,
        opinion=draft(bar_count=1),
        organization_id="organization",
        user_id="user",
        run_id="33333333-3333-3333-3333-333333333333",
        as_of=NOW,
        risk_tolerance="moderate",
    )

    signal_insert = next(
        parameters
        for query, parameters in cursor.calls
        if "INSERT INTO signal_snapshots" in query
    )
    assert isinstance(signal_insert, tuple)
    assert signal_insert[10] == "unavailable"


def test_personalization_preserves_watchlist_creation_order() -> None:
    source = getsource(PostgresBriefingRepository.load_personalization)

    assert "ORDER BY w.created_at, w.id" in source
    assert "ORDER BY a.symbol" not in source
