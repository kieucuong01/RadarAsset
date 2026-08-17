from __future__ import annotations

import json

from sync_dataset_bootstrap import build_parser, emit_fatal


def test_import_defaults_to_dry_run_until_operator_passes_apply() -> None:
    args = build_parser().parse_args(
        [
            "import",
            "--env-file",
            "production.env",
            "--manifest",
            "s3://datavest/operations/dataset-sync/batch/manifest.json",
        ]
    )

    assert args.apply is False


def test_fatal_output_redacts_configuration_details(capsys) -> None:
    emit_fatal(ValueError("postgresql://user:database-password@127.0.0.1 secret-access-key"))

    payload = json.loads(capsys.readouterr().out)
    assert payload == {"status": "fatal", "errorCode": "configuration_error"}
