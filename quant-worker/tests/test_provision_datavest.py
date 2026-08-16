from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from typing import Any

import pytest


MODULE_PATH = (
    Path(__file__).resolve().parents[2] / "deploy" / "linux" / "provision_datavest.py"
)
sys.path.insert(0, str(MODULE_PATH.parent))


def load_module() -> Any:
    spec = importlib.util.spec_from_file_location("provision_datavest", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load provision_datavest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_source_env_must_resolve_below_approved_root(tmp_path: Path) -> None:
    module = load_module()
    approved = tmp_path / "approved"
    approved.mkdir()
    valid = approved / "app.env"
    valid.write_text("KEY=value\n", encoding="utf-8")
    outside = tmp_path / "outside.env"
    outside.write_text("KEY=value\n", encoding="utf-8")

    assert module.validate_source_env(valid, approved) == valid.resolve()
    with pytest.raises(ValueError, match="approved root"):
        module.validate_source_env(outside, approved)


def test_environment_maps_only_named_values_and_preserves_existing_secrets() -> None:
    module = load_module()
    template = {
        "NODE_ENV": "production",
        "BETTER_AUTH_SECRET": "",
        "DATABASE_URL": "",
        "QUANT_ENGINE_API_TOKEN": "",
        "QUANT_WORKER_API_TOKEN": "",
        "DATAVEST_S3_ENDPOINT_URL": "",
        "DATAVEST_S3_BUCKET": "datavest",
        "DATAVEST_S3_ACCESS_KEY_ID": "",
        "DATAVEST_S3_SECRET_ACCESS_KEY": "",
        "DEEPSEEK_API_KEY": "",
        "DEEPSEEK_BASE_URL": "https://api.deepseek.com",
        "DEEPSEEK_MODEL": "",
    }
    existing = {"BETTER_AUTH_SECRET": "preserved-auth-secret"}
    deepseek = {
        "DEEPSEEK_API_KEY": "deepseek-key",
        "DEEPSEEK_MODEL": "deepseek-chat",
        "UNRELATED_SECRET": "must-not-copy",
    }
    radar = {
        "RADAR_S3_ENDPOINT_URL": "https://s3.example.test",
        "RADAR_S3_ACCESS_KEY_ID": "access-key",
        "RADAR_S3_SECRET_ACCESS_KEY": "secret-key",
        "RADAR_S3_BUCKET": "radar-public-bucket",
    }

    values = module.build_environment(
        template,
        existing,
        deepseek,
        radar,
        token=lambda: "generated-token",
    )

    assert values["BETTER_AUTH_SECRET"] == "preserved-auth-secret"
    assert values["QUANT_ENGINE_API_TOKEN"] == "generated-token"
    assert values["QUANT_WORKER_API_TOKEN"] == "generated-token"
    assert values["DEEPSEEK_API_KEY"] == "deepseek-key"
    assert values["DEEPSEEK_MODEL"] == "deepseek-chat"
    assert values["DATAVEST_S3_ENDPOINT_URL"] == "https://s3.example.test"
    assert values["DATAVEST_S3_BUCKET"] == "datavest"
    assert values["DATAVEST_S3_ACCESS_KEY_ID"] == "access-key"
    assert values["DATAVEST_S3_SECRET_ACCESS_KEY"] == "secret-key"
    assert "UNRELATED_SECRET" not in values
    assert "RADAR_S3_BUCKET" not in values
    assert values["DATABASE_URL"] == (
        "postgresql://datavest:generated-token@127.0.0.1:5432/datavest?schema=public"
    )


def test_environment_render_is_stable_and_rejects_line_injection() -> None:
    module = load_module()
    assert module.render_environment({"A": "one", "B": "two words"}) == (
        "A=one\nB='two words'\n"
    )
    with pytest.raises(ValueError, match="line breaks"):
        module.render_environment({"SECRET": "safe\nINJECTED=value"})


def test_database_sql_targets_only_fixed_datavest_role_and_database() -> None:
    module = load_module()
    password = "a1b2" * 16
    sql = module.database_provision_sql(password)

    assert f"CREATE ROLE datavest LOGIN PASSWORD '{password}'" in sql
    assert f"ALTER ROLE datavest PASSWORD '{password}'" in sql
    assert "CREATE DATABASE datavest OWNER datavest" in sql
    assert "DROP DATABASE" not in sql
    with pytest.raises(ValueError, match="hexadecimal"):
        module.database_provision_sql("unsafe'password")
