from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from smart_insights.collectors.world_gold_council import WorldGoldCouncilCollector
from smart_insights.contracts import RawSnapshot
from smart_insights.http import HttpResponse
from smart_insights.parsers.xlsx_table import read_xlsx_tables


NOW = datetime(2026, 8, 13, 13, 0, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "smart_insights" / "gold"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def workbook(rows: tuple[tuple[object, ...], ...], *, extra: dict[str, bytes] | None = None) -> bytes:
    strings: list[str] = []
    for row in rows:
        for value in row:
            if isinstance(value, str) and value not in strings:
                strings.append(value)
    string_index = {value: index for index, value in enumerate(strings)}
    shared = "".join(f"<si><t>{value}</t></si>" for value in strings)
    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            column = chr(64 + column_index)
            if isinstance(value, str):
                cells.append(
                    f'<c r="{column}{row_index}" t="s"><v>{string_index[value]}</v></c>'
                )
            else:
                cells.append(f'<c r="{column}{row_index}"><v>{value}</v></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/sharedStrings.xml", f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(strings)}" uniqueCount="{len(strings)}">{shared}</sst>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>')
        for name, content in (extra or {}).items():
            archive.writestr(name, content)
    return output.getvalue()


class FakeFirecrawl:
    def __init__(self, markdown: str) -> None:
        self.markdown = markdown

    def scrape(self, source: object, url: str) -> RawSnapshot:
        return RawSnapshot(
            content=json.dumps({
                "markdown": self.markdown,
                "rawHtml": "<main></main>",
                "metadata": {"sourceURL": url},
            }).encode(),
            content_type="application/json",
            source_url=url,
            effective_at=None,
            published_at=None,
            observed_at=NOW,
        )


class FakeTransport:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.calls: list[str] = []

    def fetch(self, url: str, *, timeout_seconds: float, max_bytes: int) -> HttpResponse:
        self.calls.append(url)
        assert max_bytes == 10_000_000
        return HttpResponse(200, {"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, self.content, url)


def test_xlsx_reader_supports_shared_strings_and_numeric_cells() -> None:
    tables = read_xlsx_tables(workbook((("Period", "Value"), ("2026-07", Decimal("12.5")))))
    assert tables[0].name == "Data"
    assert tables[0].rows == (("Period", "Value"), ("2026-07", "12.5"))


def test_xlsx_reader_rejects_macros_external_relationships_and_traversal() -> None:
    for extra, code in (
        ({"xl/vbaProject.bin": b"macro"}, "UNSAFE_WORKBOOK"),
        ({"xl/externalLinks/externalLink1.xml": b"external"}, "UNSAFE_WORKBOOK"),
        ({"../escape.xml": b"escape"}, "UNSAFE_WORKBOOK"),
    ):
        with pytest.raises(ValueError, match=code):
            read_xlsx_tables(workbook((("A",), ("1",)), extra=extra))


def test_wgc_etf_parser_preserves_reported_month_without_daily_expansion() -> None:
    content = workbook((
        ("Period", "Asset", "Flow Tonnes", "Holdings Tonnes"),
        ("2026-07", "GLOBAL_GOLD_ETF", Decimal("22.4"), Decimal("3920.1")),
        ("Footnote", "Source: World Gold Council", "", ""),
    ))
    batch = WorldGoldCouncilCollector(
        "wgc-gold-etf",
        firecrawl=FakeFirecrawl(fixture_text("wgc_etf_landing.md")),
        transport=FakeTransport(content),
    ).collect(NOW)

    assert batch.error_code is None
    flow = next(row for row in batch.observations if row.metric_code == "gold.etf_flow_tonnes")
    assert flow.value == Decimal("22.4")
    assert flow.effective_start == datetime(2026, 7, 1, tzinfo=timezone.utc)
    assert flow.effective_end == datetime(2026, 7, 31, tzinfo=timezone.utc)
    assert flow.effective_at == flow.effective_end
    assert len([row for row in batch.observations if row.metric_code == "gold.etf_flow_tonnes"]) == 1
    assert batch.snapshot.metadata["license_scope"] == "research_only"


def test_wgc_central_bank_quarantines_malformed_value() -> None:
    content = workbook((
        ("Period", "Country", "Net Purchase Tonnes"),
        ("2026-07", "GLOBAL", Decimal("37.2")),
        ("2026-07", "Malformed", "n/a?"),
    ))
    batch = WorldGoldCouncilCollector(
        "wgc-central-bank",
        firecrawl=FakeFirecrawl(fixture_text("wgc_central_bank_landing.md")),
        transport=FakeTransport(content),
    ).collect(NOW)

    assert batch.error_code == "INVALID_NUMBER"
    assert batch.observations == ()


def test_wgc_landing_requires_exactly_one_allow_listed_xlsx_link() -> None:
    duplicated = fixture_text("wgc_etf_landing.md") + "\n[Other](https://www.gold.org/download/file/other.xlsx)"
    batch = WorldGoldCouncilCollector(
        "wgc-gold-etf",
        firecrawl=FakeFirecrawl(duplicated),
        transport=FakeTransport(workbook((("A",),))),
    ).collect(NOW)
    assert batch.error_code == "SCHEMA_DRIFT"
