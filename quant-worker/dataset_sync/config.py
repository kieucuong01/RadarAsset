from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


_REQUIRED = (
    "DATABASE_URL",
    "DATAVEST_S3_ENDPOINT_URL",
    "DATAVEST_S3_BUCKET",
    "DATAVEST_S3_ACCESS_KEY_ID",
    "DATAVEST_S3_SECRET_ACCESS_KEY",
)


@dataclass(frozen=True, slots=True)
class DatasetSyncSettings:
    database_url: str = field(repr=False)
    endpoint_url: str
    bucket: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)


def _read_env_file(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ValueError("Dataset sync environment file is unavailable.") from error
    values: dict[str, str] = {}
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if value[:1] in {"'", '"'} and len(value) >= 2 and value[-1:] == value[:1]:
            value = value[1:-1]
        if name in _REQUIRED:
            values[name] = value
    return values


def load_dataset_sync_settings(
    env_file: Path,
    *,
    environ: Mapping[str, str],
    s3_env_file: Path | None = None,
    require_s3: bool = True,
) -> DatasetSyncSettings:
    values = {} if s3_env_file is None else _read_env_file(s3_env_file)
    values.update(_read_env_file(env_file))
    for name in _REQUIRED:
        if environ.get(name, "").strip():
            values[name] = environ[name].strip()
    required = _REQUIRED if require_s3 else ("DATABASE_URL",)
    missing = [name for name in required if not values.get(name, "").strip()]
    if missing:
        raise ValueError("Dataset sync configuration is incomplete.")
    if require_s3:
        if values["DATAVEST_S3_BUCKET"] != "datavest":
            raise ValueError("Dataset sync bucket must be datavest.")
        endpoint = urlsplit(values["DATAVEST_S3_ENDPOINT_URL"])
        if endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.password:
            raise ValueError("Dataset sync S3 endpoint must be an HTTPS origin.")
    database = urlsplit(values["DATABASE_URL"])
    if database.scheme not in {"postgres", "postgresql"} or not database.hostname:
        raise ValueError("Dataset sync database URL is invalid.")
    return DatasetSyncSettings(
        database_url=values["DATABASE_URL"],
        endpoint_url=values.get("DATAVEST_S3_ENDPOINT_URL", ""),
        bucket=values.get("DATAVEST_S3_BUCKET", ""),
        access_key_id=values.get("DATAVEST_S3_ACCESS_KEY_ID", ""),
        secret_access_key=values.get("DATAVEST_S3_SECRET_ACCESS_KEY", ""),
    )
