from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from html.parser import HTMLParser
import json
import re
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from smart_insights.contracts import RawSnapshot, SourceDefinition
from smart_insights.parsers.markdown_table import parse_markdown_table
from smart_insights.sources import is_source_url_allowed, source_for_code


_WEEK_URLS = {
    "current": "https://www.cryptocraft.com/calendar?week=this",
    "next": "https://www.cryptocraft.com/calendar?week=next",
}
_TIMEZONE = re.compile(r"Calendar\s+Time\s+Zone:\s*([A-Za-z_]+(?:/[A-Za-z_+-]+)+)", re.I)
_DATE = re.compile(r"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*([A-Za-z]{3,9})\s+(\d{1,2})$", re.I)
_TIME = re.compile(r"^(\d{1,2}):(\d{2})\s*(am|pm)$", re.I)
_LINK = re.compile(r"\[[^\]]+\]\((https://www\.cryptocraft\.com/calendar/[^\s\)]+)\)", re.I)
_SLUG = re.compile(r"[^a-z0-9]+")
_COUNTRY_CURRENCY = {
    "AU": "AUD",
    "CA": "CAD",
    "CH": "CNY",
    "EZ": "EUR",
    "EU": "EUR",
    "FR": "EUR",
    "GE": "EUR",
    "IT": "EUR",
    "JN": "JPY",
    "NZ": "NZD",
    "SZ": "CHF",
    "UK": "GBP",
    "US": "USD",
}


@dataclass(frozen=True, slots=True)
class CalendarEventInput:
    source_event_key: str
    name: str
    country: str
    currency: str
    impact: str
    actual: str | None
    forecast: str | None
    previous: str | None
    event_date: date
    event_at_utc: datetime | None
    time_status: str
    source_timezone: str
    detail_url: str | None
    published_at: datetime | None = None
    quality_status: str = "passed"
    quality_flags: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CalendarBatch:
    source: SourceDefinition
    snapshot: RawSnapshot
    events: tuple[CalendarEventInput, ...]
    error_code: str | None = None


class _CalendarHtmlParser(HTMLParser):
    """Extract only known calendar cell roles from Firecrawl raw HTML."""

    _ROLES = (
        "date",
        "time",
        "country",
        "currency",
        "impact",
        "event",
        "actual",
        "forecast",
        "previous",
        "detail",
    )

    def __init__(self, *, max_rows: int) -> None:
        super().__init__(convert_charrefs=True)
        self.max_rows = max_rows
        self.rows: list[dict[str, str]] = []
        self.all_text: list[str] = []
        self._row: dict[str, list[str]] | None = None
        self._role: str | None = None
        self._depth = 0

    @staticmethod
    def _attrs(attributes: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key.casefold(): value or "" for key, value in attributes}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = self._attrs(attrs)
        classes = values.get("class", "").casefold()
        if tag == "tr" and ("calendar__row" in classes or "data-event-id" in values):
            if len(self.rows) >= self.max_rows:
                raise ValueError("RESPONSE_TOO_LARGE")
            self._row = {}
            self._role = None
            self._depth = 1
            return
        if self._row is None:
            return
        self._depth += 1
        if tag in {"td", "th"}:
            tokens = set(re.split(r"[^a-z]+", classes))
            self._role = next((role for role in self._ROLES if role in tokens), None)
            if self._role:
                self._row.setdefault(self._role, [])
        if self._role == "impact":
            descriptor = " ".join(
                (classes, values.get("title", ""), values.get("aria-label", ""), values.get("alt", ""))
            )
            self._row.setdefault("impact", []).append(descriptor)
        if tag == "a" and self._role in {"event", "detail"}:
            href = values.get("href", "")
            if href:
                self._row.setdefault("detail", []).append(urljoin("https://www.cryptocraft.com", href))

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        self.all_text.append(text)
        if self._row is not None and self._role is not None:
            self._row.setdefault(self._role, []).append(text)

    def handle_endtag(self, tag: str) -> None:
        if self._row is None:
            return
        if tag in {"td", "th"}:
            self._role = None
        self._depth -= 1
        if tag == "tr" or self._depth <= 0:
            normalized = {
                key: " ".join(value).strip() for key, value in self._row.items()
            }
            if normalized:
                self.rows.append(normalized)
            self._row = None
            self._role = None
            self._depth = 0


def _optional(value: str) -> str | None:
    cleaned = " ".join(value.split())
    return cleaned or None


def _slug(value: str) -> str:
    return _SLUG.sub("-", value.casefold()).strip("-")


def _impact(value: str) -> str:
    normalized = value.casefold()
    if "high" in normalized or "impact-red" in normalized:
        return "high"
    if "medium" in normalized or re.search(r"\bmed\b", normalized) or "impact-ora" in normalized:
        return "medium"
    if "low" in normalized or "impact-yel" in normalized:
        return "low"
    raise ValueError("MISSING_IMPACT")


def _calendar_date(value: str, *, observed_at: datetime) -> date:
    match = _DATE.fullmatch(" ".join(value.split()))
    if match is None:
        raise ValueError("INVALID_DATE")
    candidates: list[date] = []
    for year in (observed_at.year - 1, observed_at.year, observed_at.year + 1):
        try:
            candidates.append(datetime.strptime(f"{match.group(1)} {match.group(2)} {year}", "%b %d %Y").date())
        except ValueError:
            try:
                candidates.append(datetime.strptime(f"{match.group(1)} {match.group(2)} {year}", "%B %d %Y").date())
            except ValueError:
                continue
    if not candidates:
        raise ValueError("INVALID_DATE")
    return min(candidates, key=lambda row: abs((row - observed_at.date()).days))


def _clock_time(value: str) -> time:
    match = _TIME.fullmatch(" ".join(value.split()))
    if match is None:
        raise ValueError("INVALID_TIME")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if not 1 <= hour <= 12 or minute > 59:
        raise ValueError("INVALID_TIME")
    if match.group(3).casefold() == "pm" and hour != 12:
        hour += 12
    if match.group(3).casefold() == "am" and hour == 12:
        hour = 0
    return time(hour, minute)


def _event_identity(
    *, currency: str, name: str, event_date: date, event_at: datetime | None, time_status: str
) -> str:
    if event_at is not None:
        instant = event_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        instant = f"{event_date.isoformat()}:{time_status}"
    return f"cryptocraft:{currency}:{_slug(name)}:{instant}"


class CryptoCraftCollector:
    def __init__(self, *, firecrawl: Any) -> None:
        self.source = source_for_code("cryptocraft")
        self._firecrawl = firecrawl

    def collect_week(self, week: str, *, observed_at: datetime) -> CalendarBatch:
        if week not in _WEEK_URLS:
            raise ValueError("INVALID_WEEK")
        if observed_at.tzinfo is None or observed_at.utcoffset() is None:
            raise ValueError("observed_at must be timezone-aware.")
        url = _WEEK_URLS[week]
        snapshot = self._firecrawl.scrape(self.source, url)
        try:
            payload = json.loads(snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CalendarBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        if not isinstance(payload, dict):
            return CalendarBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        markdown = payload.get("markdown")
        raw_html = payload.get("rawHtml")
        if not isinstance(markdown, str):
            markdown = ""
        if not isinstance(raw_html, str):
            raw_html = ""
        timezone_match = _TIMEZONE.search(markdown)
        html_parser: _CalendarHtmlParser | None = None
        if timezone_match is None and raw_html:
            try:
                html_parser = _CalendarHtmlParser(max_rows=1_000)
                html_parser.feed(raw_html)
            except ValueError as error:
                return CalendarBatch(self.source, snapshot, (), str(error))
            timezone_match = _TIMEZONE.search(" ".join(html_parser.all_text))
        if timezone_match is None:
            return CalendarBatch(self.source, snapshot, (), "MISSING_TIMEZONE")
        source_timezone = timezone_match.group(1)
        try:
            zone = ZoneInfo(source_timezone)
        except ZoneInfoNotFoundError:
            return CalendarBatch(self.source, snapshot, (), "INVALID_TIMEZONE")
        try:
            rows = self._markdown_rows(markdown)
            events = self._normalize_rows(
                rows,
                observed_at=observed_at.astimezone(zone),
                source_timezone=source_timezone,
                zone=zone,
                published_at=snapshot.published_at,
            )
        except ValueError as markdown_error:
            if str(markdown_error) not in {"SCHEMA_DRIFT", "MISSING_IMPACT"} or not raw_html:
                return CalendarBatch(self.source, snapshot, (), str(markdown_error))
            try:
                if html_parser is None:
                    html_parser = _CalendarHtmlParser(max_rows=1_000)
                    html_parser.feed(raw_html)
                events = self._normalize_rows(
                    tuple(html_parser.rows),
                    observed_at=observed_at.astimezone(zone),
                    source_timezone=source_timezone,
                    zone=zone,
                    published_at=snapshot.published_at,
                )
            except ValueError as html_error:
                return CalendarBatch(self.source, snapshot, (), str(html_error))
        return CalendarBatch(self.source, snapshot, events)

    @staticmethod
    def _markdown_rows(markdown: str) -> tuple[dict[str, str], ...]:
        table = parse_markdown_table(
            markdown,
            required_headers=("Date", "Time", "Impact", "Event", "Actual", "Forecast", "Previous"),
            max_rows=1_000,
            max_columns=20,
        )
        normalized_headers = {header.casefold(): header for header in table.headers}
        geography_header = normalized_headers.get("country") or normalized_headers.get("currency")
        if geography_header is None:
            raise ValueError("SCHEMA_DRIFT")
        output: list[dict[str, str]] = []
        for parsed, raw in zip(table.rows, table.raw_rows):
            row = {header.casefold(): value for header, value in parsed.items()}
            row["country"] = parsed[geography_header]
            event_index = table.headers.index(normalized_headers["event"])
            link = _LINK.search(raw[event_index])
            detail = row.get("detail", "")
            if not detail and link:
                detail = link.group(1)
            row["detail"] = detail
            output.append(row)
        return tuple(output)

    def _normalize_rows(
        self,
        rows: tuple[dict[str, str], ...],
        *,
        observed_at: datetime,
        source_timezone: str,
        zone: ZoneInfo,
        published_at: datetime | None,
    ) -> tuple[CalendarEventInput, ...]:
        if not rows:
            raise ValueError("SCHEMA_DRIFT")
        current_date: date | None = None
        current_time: time | None = None
        seen: dict[str, CalendarEventInput] = {}
        for row in rows:
            date_text = row.get("date", "").strip()
            if date_text:
                current_date = _calendar_date(date_text, observed_at=observed_at)
                current_time = None
            if current_date is None:
                raise ValueError("INVALID_DATE")
            time_text = row.get("time", "").strip()
            normalized_time = time_text.casefold()
            if normalized_time == "tentative":
                time_status = "tentative"
                event_at = None
            elif normalized_time == "all day" or re.fullmatch(r"day\s+\d+", normalized_time):
                time_status = "all_day"
                event_at = None
            else:
                if time_text:
                    current_time = _clock_time(time_text)
                if current_time is None:
                    raise ValueError("INVALID_TIME")
                time_status = "timed"
                event_at = datetime.combine(current_date, current_time, tzinfo=zone).astimezone(timezone.utc)
            name = " ".join(row.get("event", "").split())
            country = row.get("country", row.get("currency", "")).strip().upper()
            currency = _COUNTRY_CURRENCY.get(country, country if len(country) == 3 else "")
            if not name or not country or not currency:
                raise ValueError("SCHEMA_DRIFT")
            impact = _impact(row.get("impact", ""))
            detail_url = _optional(row.get("detail", ""))
            if detail_url is not None and not is_source_url_allowed(self.source, detail_url):
                raise ValueError("REDIRECT_REJECTED")
            source_event_key = _event_identity(
                currency=currency,
                name=name,
                event_date=current_date,
                event_at=event_at,
                time_status=time_status,
            )
            event = CalendarEventInput(
                source_event_key=source_event_key,
                name=name,
                country=country,
                currency=currency,
                impact=impact,
                actual=_optional(row.get("actual", "")),
                forecast=_optional(row.get("forecast", "")),
                previous=_optional(row.get("previous", "")),
                event_date=current_date,
                event_at_utc=event_at,
                time_status=time_status,
                source_timezone=source_timezone,
                detail_url=detail_url,
                published_at=published_at,
            )
            prior = seen.get(source_event_key)
            if prior is not None and prior != event:
                raise ValueError("DUPLICATE_CONFLICT")
            seen[source_event_key] = event
        return tuple(seen.values())
