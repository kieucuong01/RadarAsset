from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from importlib.metadata import version
import re
from typing import Protocol, Sequence
from urllib.parse import urljoin

from .sources import is_source_url_allowed, source_for_code


_MILLION = Decimal("1000000")
_RECONCILIATION_TOLERANCE = Decimal("100000")
_NUMBER = re.compile(r"^\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$")
_PERIOD = re.compile(
    r"data\s+available\s+as\s+(?:at|of)\s+close\s+"
    r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
    re.IGNORECASE,
)
_PUBLISHED = re.compile(
    r"published\s+on\s+([A-Za-z]{3,9})\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class OcrToken:
    text: str
    confidence: Decimal
    box: tuple[int, int, int, int]

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("OCR token text is required.")
        if not Decimal("0") <= self.confidence <= Decimal("1"):
            raise ValueError("OCR token confidence is outside zero to one.")
        if len(self.box) != 4 or self.box[0] >= self.box[2] or self.box[1] >= self.box[3]:
            raise ValueError("OCR token box is invalid.")


class OcrEngine(Protocol):
    version: str

    def recognize(self, image: bytes) -> tuple[OcrToken, ...]: ...


@dataclass(frozen=True, slots=True)
class CoinSharesRow:
    label: str
    week_flow_usd: Decimal
    aum_usd: Decimal


@dataclass(frozen=True, slots=True)
class CoinSharesTable:
    dimension: str
    rows: tuple[CoinSharesRow, ...]
    effective_at: datetime
    global_flow_usd: Decimal
    global_aum_usd: Decimal | None
    minimum_confidence: Decimal


class _ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[tuple[str, str]] = []
        self.text: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.casefold() != "img":
            return
        values = {name.casefold(): value or "" for name, value in attrs}
        source = values.get("src") or values.get("data-src")
        if source:
            self.images.append((source, values.get("alt", "")))

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.text.append(value)


def discover_coinshares_images(html: str, report_url: str) -> dict[str, str]:
    parser = _ArticleParser()
    parser.feed(html)
    source = source_for_code("coinshares-weekly")
    candidates: dict[str, list[str]] = {"asset": [], "region": []}
    for raw_url, alt in parser.images:
        normalized_alt = " ".join(alt.casefold().split())
        kind = None
        if "ranked flows detail" in normalized_alt:
            kind = "asset"
        elif "flows by exchange country" in normalized_alt:
            kind = "region"
        if kind is None:
            continue
        url = urljoin(report_url, raw_url)
        if not is_source_url_allowed(source, url):
            raise ValueError("REDIRECT_REJECTED")
        candidates[kind].append(url)
    if any(not candidates[kind] for kind in candidates):
        raise ValueError("MISSING_TABLE")
    if any(len(candidates[kind]) != 1 for kind in candidates):
        raise ValueError("OCR_LAYOUT_DRIFT")
    return {kind: urls[0] for kind, urls in candidates.items()}


def published_at_from_html(html: str) -> datetime:
    parser = _ArticleParser()
    parser.feed(html)
    match = _PUBLISHED.search(" ".join(parser.text))
    if match is None:
        raise ValueError("MISSING_PUBLISHED_AT")
    value = f"{match.group(1)} {match.group(2)} {match.group(3)}"
    for date_format in ("%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(value, date_format).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError("INVALID_TIMESTAMP")


def _axis_aligned_box(points: object) -> tuple[int, int, int, int]:
    try:
        coordinates = tuple((float(point[0]), float(point[1])) for point in points)  # type: ignore[index, union-attr]
    except (TypeError, ValueError, IndexError) as error:
        raise ValueError("OCR_LAYOUT_DRIFT") from error
    if len(coordinates) != 4:
        raise ValueError("OCR_LAYOUT_DRIFT")
    xs = tuple(point[0] for point in coordinates)
    ys = tuple(point[1] for point in coordinates)
    return (round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)))


class RapidOcrEngine:
    def __init__(self) -> None:
        from rapidocr import RapidOCR

        self._engine = RapidOCR()
        self.version = f"rapidocr-{version('rapidocr')}-onnxruntime"

    def recognize(self, image: bytes) -> tuple[OcrToken, ...]:
        try:
            result = self._engine(image)
            boxes = result.boxes
            texts = result.txts
            scores = result.scores
        except Exception as error:
            raise ValueError("INVALID_RESPONSE") from error
        if boxes is None or texts is None or scores is None:
            return ()
        try:
            return tuple(
                OcrToken(
                    text=str(text),
                    confidence=Decimal(str(score)),
                    box=_axis_aligned_box(box),
                )
                for box, text, score in zip(boxes, texts, scores, strict=True)
            )
        except (TypeError, ValueError) as error:
            raise ValueError("OCR_LAYOUT_DRIFT") from error


def _center_x(token: OcrToken) -> Decimal:
    return Decimal(token.box[0] + token.box[2]) / Decimal("2")


def _center_y(token: OcrToken) -> Decimal:
    return Decimal(token.box[1] + token.box[3]) / Decimal("2")


def _groups(tokens: Sequence[OcrToken]) -> tuple[tuple[OcrToken, ...], ...]:
    groups: list[list[OcrToken]] = []
    for token in sorted(tokens, key=lambda row: (_center_y(row), _center_x(row))):
        if not groups:
            groups.append([token])
            continue
        group_center = sum((_center_y(row) for row in groups[-1]), Decimal("0")) / Decimal(
            len(groups[-1])
        )
        tolerance = max(Decimal("8"), Decimal(token.box[3] - token.box[1]) / Decimal("2"))
        if abs(_center_y(token) - group_center) <= tolerance:
            groups[-1].append(token)
        else:
            groups.append([token])
    return tuple(tuple(sorted(group, key=_center_x)) for group in groups)


def _header_key(value: str, dimension: str) -> str | None:
    normalized = re.sub(r"[^a-z]", "", value.casefold())
    if dimension == "asset" and normalized == "asset":
        return "label"
    if dimension == "region" and normalized in {"country", "region"}:
        return "label"
    if normalized in {"weekflow", "weekflows"}:
        return "week"
    if normalized == "aum":
        return "aum"
    if normalized in {"mtdflow", "mtdflows"}:
        return "mtd"
    if normalized in {"ytdflow", "ytdflows"}:
        return "ytd"
    return None


def _money(value: str) -> Decimal:
    cleaned = value.strip().replace(" ", "")
    if not _NUMBER.fullmatch(cleaned):
        raise ValueError("OCR_LAYOUT_DRIFT")
    negative_parentheses = cleaned.startswith("(") and cleaned.endswith(")")
    if negative_parentheses:
        cleaned = cleaned[1:-1]
    cleaned = cleaned.replace("$", "").replace(",", "")
    try:
        amount = Decimal(cleaned) * _MILLION
    except InvalidOperation as error:
        raise ValueError("OCR_LAYOUT_DRIFT") from error
    return -amount if negative_parentheses else amount


def _effective_at(tokens: Sequence[OcrToken], minimum_confidence: Decimal) -> datetime:
    for token in tokens:
        match = _PERIOD.search(token.text)
        if match is None:
            continue
        if token.confidence < minimum_confidence:
            raise ValueError("OCR_LOW_CONFIDENCE")
        for date_format in ("%d %B %Y", "%d %b %Y"):
            try:
                return datetime.strptime(match.group(1), date_format).replace(
                    tzinfo=timezone.utc
                )
            except ValueError:
                continue
        raise ValueError("INVALID_TIMESTAMP")
    raise ValueError("MISSING_PERIOD")


def reconstruct_coinshares_table(
    tokens: Sequence[OcrToken],
    *,
    dimension: str,
    minimum_confidence: Decimal = Decimal("0.90"),
) -> CoinSharesTable:
    if dimension not in {"asset", "region"}:
        raise ValueError("OCR_LAYOUT_DRIFT")
    if not tokens:
        raise ValueError("MISSING_TABLE")
    unit_tokens = tuple(
        token
        for token in tokens
        if "us$m" in token.text.casefold().replace(" ", "")
    )
    if not unit_tokens:
        raise ValueError("INVALID_UNIT")
    if any(token.confidence < minimum_confidence for token in unit_tokens):
        raise ValueError("OCR_LOW_CONFIDENCE")
    effective_at = _effective_at(tokens, minimum_confidence)

    grouped = _groups(tokens)
    header: tuple[OcrToken, ...] | None = None
    columns: list[tuple[Decimal, str, OcrToken]] = []
    for group in grouped:
        keyed = tuple(
            (_center_x(token), key, token)
            for token in group
            if (key := _header_key(token.text, dimension)) is not None
        )
        required = {key for _, key, _ in keyed}
        if {"label", "week", "aum"}.issubset(required):
            if header is not None:
                raise ValueError("OCR_LAYOUT_DRIFT")
            header = group
            columns = sorted(keyed, key=lambda row: row[0])
    if header is None:
        raise ValueError("OCR_LAYOUT_DRIFT")
    if any(token.confidence < minimum_confidence for _, key, token in columns if key in {"label", "week", "aum"}):
        raise ValueError("OCR_LOW_CONFIDENCE")

    header_y = max(_center_y(token) for token in header)
    rows: list[CoinSharesRow] = []
    seen: set[str] = set()
    used_confidences: list[Decimal] = []
    for group in grouped:
        if min(_center_y(token) for token in group) <= header_y:
            continue
        combined = " ".join(token.text for token in group)
        if "source:" in combined.casefold() or "data available" in combined.casefold():
            continue
        assigned: dict[str, list[OcrToken]] = {key: [] for key in {"label", "week", "aum", "mtd", "ytd"}}
        for token in group:
            _, key, _ = min(columns, key=lambda row: abs(row[0] - _center_x(token)))
            assigned[key].append(token)
        if not any(assigned[key] for key in {"label", "week", "aum"}):
            continue
        if not assigned["label"] or len(assigned["week"]) != 1 or len(assigned["aum"]) != 1:
            raise ValueError("OCR_LAYOUT_DRIFT")
        label = " ".join(token.text.strip() for token in assigned["label"]).strip()
        normalized = label.casefold()
        if not label or normalized in seen:
            raise ValueError("DUPLICATE_SERIES")
        used = (*assigned["label"], assigned["week"][0], assigned["aum"][0])
        if any(token.confidence < minimum_confidence for token in used):
            raise ValueError("OCR_LOW_CONFIDENCE")
        seen.add(normalized)
        used_confidences.extend(token.confidence for token in used)
        rows.append(
            CoinSharesRow(
                label=label,
                week_flow_usd=_money(assigned["week"][0].text),
                aum_usd=_money(assigned["aum"][0].text),
            )
        )
    if len(rows) < 2:
        raise ValueError("OCR_LAYOUT_DRIFT")
    if any(row.aum_usd < 0 for row in rows):
        raise ValueError("INVALID_VALUE")

    total = next((row for row in rows if row.label.casefold() == "total"), None)
    non_total = tuple(row for row in rows if row.label.casefold() != "total")
    summed_flow = sum((row.week_flow_usd for row in non_total), Decimal("0"))
    if dimension == "region":
        if total is None:
            raise ValueError("OCR_LAYOUT_DRIFT")
        if abs(summed_flow - total.week_flow_usd) > _RECONCILIATION_TOLERANCE:
            raise ValueError("RECONCILIATION_FAILED")
        global_flow = total.week_flow_usd
        global_aum = total.aum_usd
    else:
        global_flow = total.week_flow_usd if total else summed_flow
        if total and abs(summed_flow - total.week_flow_usd) > _RECONCILIATION_TOLERANCE:
            raise ValueError("RECONCILIATION_FAILED")
        global_aum = total.aum_usd if total else None
    return CoinSharesTable(
        dimension=dimension,
        rows=tuple(rows),
        effective_at=effective_at,
        global_flow_usd=global_flow,
        global_aum_usd=global_aum,
        minimum_confidence=min(used_confidences),
    )
