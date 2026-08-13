from __future__ import annotations

from dataclasses import dataclass
import re
from collections.abc import Mapping, Sequence


_SEPARATOR = re.compile(r"^:?-{3,}:?$")
_LINK = re.compile(r"\[([^\]]+)\]\([^\)]+\)")


@dataclass(frozen=True, slots=True)
class MarkdownTable:
    headers: tuple[str, ...]
    rows: tuple[Mapping[str, str], ...]
    raw_rows: tuple[tuple[str, ...], ...]


def _cells(line: str) -> tuple[str, ...]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return tuple(cell.strip() for cell in stripped.split("|"))


def _plain(cell: str) -> str:
    value = _LINK.sub(r"\1", cell.strip())
    value = value.replace("**", "").replace("__", "").replace("`", "")
    value = value.strip("*_ ")
    return value


def _is_separator(line: str, expected_columns: int) -> bool:
    cells = _cells(line)
    return len(cells) == expected_columns and all(
        _SEPARATOR.fullmatch(cell.replace(" ", "")) for cell in cells
    )


def parse_markdown_table(
    markdown: str,
    required_headers: Sequence[str],
    *,
    max_rows: int = 500,
    max_columns: int = 100,
) -> MarkdownTable:
    if max_rows <= 0 or max_columns <= 0:
        raise ValueError("Parser bounds must be positive.")
    required = tuple(header.strip().casefold() for header in required_headers)
    if not required or any(not header for header in required):
        raise ValueError("Required headers must not be empty.")

    lines = markdown.splitlines()
    matches: list[MarkdownTable] = []
    for index in range(len(lines) - 1):
        raw_headers = _cells(lines[index])
        if not raw_headers or len(raw_headers) > max_columns:
            continue
        if not _is_separator(lines[index + 1], len(raw_headers)):
            continue
        headers = tuple(_plain(cell) for cell in raw_headers)
        normalized = tuple(header.casefold() for header in headers)
        if any(normalized.count(header) != 1 for header in required):
            continue

        raw_rows: list[tuple[str, ...]] = []
        parsed_rows: list[Mapping[str, str]] = []
        for line in lines[index + 2 :]:
            if "|" not in line:
                break
            row = _cells(line)
            if len(row) != len(headers):
                break
            if len(raw_rows) >= max_rows:
                raise ValueError("RESPONSE_TOO_LARGE")
            raw_rows.append(row)
            parsed_rows.append(
                {header: _plain(cell) for header, cell in zip(headers, row)}
            )
        matches.append(
            MarkdownTable(
                headers=headers,
                rows=tuple(parsed_rows),
                raw_rows=tuple(raw_rows),
            )
        )

    if len(matches) != 1:
        raise ValueError("SCHEMA_DRIFT")
    return matches[0]
