from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping, Sequence
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import tempfile
from urllib.parse import quote, unquote, urlsplit

from datavest_env import read_env_file


_VARIABLE_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
_HEX_SECRET = re.compile(r"^[0-9a-f]{64}$")
_GENERATED_NAMES = (
    "BETTER_AUTH_SECRET",
    "QUANT_ENGINE_API_TOKEN",
    "QUANT_WORKER_API_TOKEN",
    "DATAVEST_BACKUP_ENCRYPTION_SECRET",
)


def validate_source_env(path: Path, approved_root: Path) -> Path:
    resolved = path.resolve(strict=True)
    root = approved_root.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Source environment path must be a regular file.")
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("Source environment path is outside its approved root.") from error
    return resolved


def build_environment(
    template: Mapping[str, str],
    existing: Mapping[str, str],
    deepseek: Mapping[str, str],
    radar: Mapping[str, str],
    *,
    token: Callable[[], str] = lambda: secrets.token_hex(32),
) -> dict[str, str]:
    values = dict(template)
    for name, value in existing.items():
        if name in values and value:
            values[name] = value
    for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"):
        if deepseek.get(name, "").strip():
            values[name] = deepseek[name].strip()
    s3_mapping = {
        "RADAR_S3_ENDPOINT_URL": "DATAVEST_S3_ENDPOINT_URL",
        "RADAR_S3_ACCESS_KEY_ID": "DATAVEST_S3_ACCESS_KEY_ID",
        "RADAR_S3_SECRET_ACCESS_KEY": "DATAVEST_S3_SECRET_ACCESS_KEY",
    }
    for source_name, target_name in s3_mapping.items():
        if radar.get(source_name, "").strip():
            values[target_name] = radar[source_name].strip()
    values["DATAVEST_S3_BUCKET"] = "datavest"
    for name in _GENERATED_NAMES:
        if name in values and not values[name]:
            values[name] = token()
    if not values.get("DATABASE_URL"):
        database_password = token()
        values["DATABASE_URL"] = (
            "postgresql://datavest:"
            f"{quote(database_password, safe='')}@127.0.0.1:5432/datavest?schema=public"
        )
    return values


def render_environment(values: Mapping[str, str]) -> str:
    lines: list[str] = []
    for name, value in values.items():
        if not _VARIABLE_NAME.fullmatch(name):
            raise ValueError(f"Invalid environment variable name: {name}.")
        if "\n" in value or "\r" in value:
            raise ValueError("Environment values must not contain line breaks.")
        lines.append(f"{name}={shlex.quote(value)}")
    return "\n".join(lines) + "\n"


def database_provision_sql(password: str) -> str:
    if not _HEX_SECRET.fullmatch(password):
        raise ValueError("Database password must be a 64-character hexadecimal secret.")
    return f"""\
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'datavest') THEN
    CREATE ROLE datavest LOGIN PASSWORD '{password}';
  ELSE
    ALTER ROLE datavest PASSWORD '{password}';
  END IF;
END
$$;
SELECT 'CREATE DATABASE datavest OWNER datavest'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'datavest')\\gexec
ALTER DATABASE datavest OWNER TO datavest;
REVOKE ALL ON DATABASE datavest FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE datavest TO datavest;
"""


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, 0o640)
        os.replace(temporary_name, path)
    finally:
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)


def _required(values: Mapping[str, str], names: Sequence[str]) -> None:
    for name in names:
        if not values.get(name, "").strip():
            raise ValueError(f"{name} is required.")


def _render_command(args: argparse.Namespace) -> int:
    template = read_env_file(Path(args.template))
    existing_path = Path(args.existing)
    existing = read_env_file(existing_path) if existing_path.is_file() else {}
    deepseek = read_env_file(Path(args.deepseek_env))
    radar = read_env_file(Path(args.s3_env))
    _required(deepseek, ("DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"))
    _required(
        radar,
        (
            "RADAR_S3_ENDPOINT_URL",
            "RADAR_S3_ACCESS_KEY_ID",
            "RADAR_S3_SECRET_ACCESS_KEY",
        ),
    )
    values = build_environment(template, existing, deepseek, radar)
    _required(
        values,
        (
            "BETTER_AUTH_SECRET",
            "DATABASE_URL",
            "QUANT_ENGINE_API_TOKEN",
            "QUANT_WORKER_API_TOKEN",
            "DATAVEST_S3_ENDPOINT_URL",
            "DATAVEST_S3_ACCESS_KEY_ID",
            "DATAVEST_S3_SECRET_ACCESS_KEY",
            "DEEPSEEK_API_KEY",
        ),
    )
    _write_atomic(Path(args.output), render_environment(values))
    return 0


def _database_command(args: argparse.Namespace) -> int:
    values = read_env_file(Path(args.env_file))
    parsed = urlsplit(values.get("DATABASE_URL", ""))
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("DATABASE_URL must be PostgreSQL.")
    if parsed.username != "datavest" or unquote(parsed.path.lstrip("/")) != "datavest":
        raise ValueError("DATABASE_URL must target the fixed datavest role and database.")
    password = unquote(parsed.password or "")
    subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-v", "ON_ERROR_STOP=1"],
        input=database_provision_sql(password),
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return 0


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Provision DataVest environment data.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    render = subparsers.add_parser("render-env")
    render.add_argument("--template", required=True)
    render.add_argument("--existing", required=True)
    render.add_argument("--deepseek-env", required=True)
    render.add_argument("--s3-env", required=True)
    render.add_argument("--output", required=True)
    database = subparsers.add_parser("provision-db")
    database.add_argument("--env-file", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    if args.command == "render-env":
        return _render_command(args)
    return _database_command(args)


if __name__ == "__main__":
    raise SystemExit(main())
