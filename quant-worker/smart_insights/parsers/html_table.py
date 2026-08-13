from __future__ import annotations

from datetime import datetime
from html.parser import HTMLParser

from .markdown_table import MarkdownTable


_DATE_FORMATS = ("%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%b %d, %Y")


class _TableParser(HTMLParser):
    def __init__(self, *, max_rows: int, max_columns: int) -> None:
        super().__init__(convert_charrefs=True)
        self.max_rows = max_rows
        self.max_columns = max_columns
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(
        self, tag: str, _attrs: list[tuple[str, str | None]]
    ) -> None:
        normalized = tag.casefold()
        if normalized == "table" and self._table is None:
            self._table = []
        elif normalized == "tr" and self._table is not None and self._row is None:
            self._row = []
        elif (
            normalized in {"td", "th"}
            and self._row is not None
            and self._cell is None
        ):
            self._cell = []
        elif normalized == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.casefold()
        if normalized in {"td", "th"} and self._cell is not None:
            assert self._row is not None
            value = " ".join("".join(self._cell).split())
            self._row.append(value)
            if len(self._row) > self.max_columns:
                raise ValueError("RESPONSE_TOO_LARGE")
            self._cell = None
        elif normalized == "tr" and self._row is not None:
            assert self._table is not None
            if self._row:
                self._table.append(self._row)
                if len(self._table) > self.max_rows:
                    raise ValueError("RESPONSE_TOO_LARGE")
            self._row = None
            self._cell = None
        elif normalized == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None
            self._row = None
            self._cell = None


def parse_html_tables(
    html: str, *, max_rows: int = 500, max_columns: int = 100
) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if max_rows <= 0 or max_columns <= 0:
        raise ValueError("Parser bounds must be positive.")
    parser = _TableParser(max_rows=max_rows, max_columns=max_columns)
    try:
        parser.feed(html)
        parser.close()
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("SCHEMA_DRIFT") from error
    return tuple(
        tuple(tuple(cell for cell in row) for row in table)
        for table in parser.tables
    )


def _is_date(value: str) -> bool:
    cleaned = value.strip().rstrip("*")
    for date_format in _DATE_FORMATS:
        try:
            datetime.strptime(cleaned, date_format)
            return True
        except ValueError:
            continue
    return False


def normalize_farside_table(html: str) -> MarkdownTable:
    matches: list[MarkdownTable] = []
    for table in parse_html_tables(html):
        for index in range(len(table) - 1):
            total_row = table[index]
            ticker_row = table[index + 1]
            if (
                len(total_row) < 3
                or len(ticker_row) != len(total_row)
                or total_row[-1].casefold() != "total"
            ):
                continue
            funds = tuple(cell.strip() for cell in ticker_row[1:-1])
            if not funds or any(not fund for fund in funds):
                continue
            headers = ("Date", *funds, "Total")
            if len({header.casefold() for header in headers}) != len(headers):
                continue
            raw_rows = tuple(
                row
                for row in table[index + 2 :]
                if len(row) == len(headers) and _is_date(row[0])
            )
            if not raw_rows:
                continue
            matches.append(
                MarkdownTable(
                    headers=headers,
                    rows=tuple(
                        dict(zip(headers, row, strict=True)) for row in raw_rows
                    ),
                    raw_rows=raw_rows,
                )
            )
    if len(matches) != 1:
        raise ValueError("SCHEMA_DRIFT")
    return matches[0]
