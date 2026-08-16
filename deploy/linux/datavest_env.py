from __future__ import annotations

from pathlib import Path
import re


_VARIABLE_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid environment line {line_number}.")
        name, raw_value = line.split("=", 1)
        name = name.strip()
        if not _VARIABLE_NAME.fullmatch(name):
            raise ValueError(f"Invalid environment variable name on line {line_number}.")
        if name in values:
            raise ValueError(f"Duplicate environment variable: {name}.")
        value = raw_value.strip()
        if value[:1] in {'"', "'"}:
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Unterminated quoted value on line {line_number}.")
            value = value[1:-1]
        values[name] = value
    return values
