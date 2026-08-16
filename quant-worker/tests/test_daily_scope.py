from backtest.daily_scope import CORE_DAILY_SYMBOLS, load_daily_scope_symbols


class ScopeCursor:
    def __init__(self) -> None:
        self.query = ""
        self.params: tuple[object, ...] = ()

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.query = query
        self.params = params

    def fetchall(self) -> list[tuple[str]]:
        return [("fpt",), ("ADA",), ("fpt",), ("VNINDEX",)]

    def __enter__(self) -> "ScopeCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


class ScopeConnection:
    def __init__(self) -> None:
        self.cursor_value = ScopeCursor()

    def cursor(self) -> ScopeCursor:
        return self.cursor_value


def test_daily_scope_is_curated_plus_held_or_watched_supported_assets() -> None:
    connection = ScopeConnection()

    symbols = load_daily_scope_symbols(connection)

    assert symbols == ("ADA", "FPT", "VNINDEX")
    assert {"VNINDEX", "VN30", "BTC", "ETH", "SOL", "XAU"} <= set(
        CORE_DAILY_SYMBOLS
    )
    query = connection.cursor_value.query
    assert "portfolio_positions" in query
    assert "watchlist_items" in query
    assert "position.quantity > 0" in query
    assert "instrument.is_active = true" in query
    assert "provider.status = 'active'" in query
    assert "asset.market IN ('vn_equity', 'crypto_spot', 'metal_spot')" in query
    assert "asset.market = 'us_equity'" not in query
    assert connection.cursor_value.params == (list(CORE_DAILY_SYMBOLS),)

