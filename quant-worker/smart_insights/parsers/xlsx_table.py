from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import re
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile


_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
_OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_CELL = re.compile(r"^([A-Z]+)(\d+)$")


@dataclass(frozen=True, slots=True)
class XlsxTable:
    name: str
    rows: tuple[tuple[str, ...], ...]


def _column_index(reference: str) -> int:
    match = _CELL.fullmatch(reference)
    if match is None:
        raise ValueError("SCHEMA_DRIFT")
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - 64
    return result - 1


def _xml(archive: ZipFile, name: str) -> ElementTree.Element:
    try:
        content = archive.read(name)
    except KeyError as error:
        raise ValueError("SCHEMA_DRIFT") from error
    try:
        return ElementTree.fromstring(content)
    except ElementTree.ParseError as error:
        raise ValueError("SCHEMA_DRIFT") from error


def _shared_strings(archive: ZipFile) -> tuple[str, ...]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return ()
    root = _xml(archive, "xl/sharedStrings.xml")
    return tuple(
        "".join(node.text or "" for node in item.iter(f"{{{_MAIN}}}t"))
        for item in root.findall(f"{{{_MAIN}}}si")
    )


def _worksheets(archive: ZipFile) -> tuple[tuple[str, str], ...]:
    workbook = _xml(archive, "xl/workbook.xml")
    relationships = _xml(archive, "xl/_rels/workbook.xml.rels")
    targets = {
        row.attrib.get("Id", ""): row.attrib.get("Target", "")
        for row in relationships.findall(f"{{{_REL}}}Relationship")
    }
    output: list[tuple[str, str]] = []
    for sheet in workbook.findall(f".//{{{_MAIN}}}sheet"):
        name = sheet.attrib.get("name", "")
        relationship_id = sheet.attrib.get(f"{{{_OFFICE_REL}}}id", "")
        target = targets.get(relationship_id, "")
        if not name or not target:
            raise ValueError("SCHEMA_DRIFT")
        path = target.replace("\\", "/")
        if not path.startswith("xl/"):
            path = f"xl/{path.lstrip('/')}"
        output.append((name, path))
    if not output or len(output) > 20:
        raise ValueError("RESPONSE_TOO_LARGE" if output else "SCHEMA_DRIFT")
    return tuple(output)


def _cell_value(
    cell: ElementTree.Element, shared_strings: tuple[str, ...]
) -> str:
    if cell.find(f"{{{_MAIN}}}f") is not None:
        return ""
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(
            node.text or "" for node in cell.iter(f"{{{_MAIN}}}t")
        )
    value_node = cell.find(f"{{{_MAIN}}}v")
    if value_node is None or value_node.text is None:
        return ""
    value = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(value)]
        except (ValueError, IndexError) as error:
            raise ValueError("SCHEMA_DRIFT") from error
    if cell_type == "b":
        return "TRUE" if value == "1" else "FALSE"
    return value


def read_xlsx_tables(content: bytes) -> tuple[XlsxTable, ...]:
    if not content or len(content) > 10_000_000:
        raise ValueError("RESPONSE_TOO_LARGE")
    try:
        archive = ZipFile(BytesIO(content))
    except BadZipFile as error:
        raise ValueError("INVALID_RESPONSE") from error
    with archive:
        infos = archive.infolist()
        if any(info.flag_bits & 1 for info in infos):
            raise ValueError("UNSAFE_WORKBOOK")
        for info in infos:
            normalized = info.filename.replace("\\", "/")
            if (
                normalized.startswith("/")
                or ".." in normalized.split("/")
                or normalized.casefold().endswith("vbaproject.bin")
                or "/externallinks/" in f"/{normalized.casefold()}"
            ):
                raise ValueError("UNSAFE_WORKBOOK")
        xml_size = sum(
            info.file_size for info in infos if info.filename.casefold().endswith(".xml")
        )
        if xml_size > 20_000_000:
            raise ValueError("RESPONSE_TOO_LARGE")
        for info in infos:
            if not info.filename.casefold().endswith(".rels"):
                continue
            relationships = _xml(archive, info.filename)
            if any(
                row.attrib.get("TargetMode", "").casefold() == "external"
                for row in relationships.findall(f"{{{_REL}}}Relationship")
            ):
                raise ValueError("UNSAFE_WORKBOOK")

        shared_strings = _shared_strings(archive)
        tables: list[XlsxTable] = []
        for sheet_name, sheet_path in _worksheets(archive):
            root = _xml(archive, sheet_path)
            parsed_rows: list[tuple[str, ...]] = []
            for row in root.findall(f".//{{{_MAIN}}}row"):
                if len(parsed_rows) >= 20_000:
                    raise ValueError("RESPONSE_TOO_LARGE")
                values: dict[int, str] = {}
                for cell in row.findall(f"{{{_MAIN}}}c"):
                    index = _column_index(cell.attrib.get("r", ""))
                    if index >= 200:
                        raise ValueError("RESPONSE_TOO_LARGE")
                    values[index] = _cell_value(cell, shared_strings)
                if values:
                    parsed_rows.append(
                        tuple(values.get(index, "") for index in range(max(values) + 1))
                    )
            if parsed_rows:
                tables.append(XlsxTable(sheet_name, tuple(parsed_rows)))
        if not tables:
            raise ValueError("SCHEMA_DRIFT")
        return tuple(tables)
