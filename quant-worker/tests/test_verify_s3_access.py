from __future__ import annotations

import importlib.util
from io import BytesIO, StringIO
from pathlib import Path
import sys
from typing import Any

import pytest


DEPLOY_DIR = Path(__file__).resolve().parents[2] / "deploy" / "linux"
sys.path.insert(0, str(DEPLOY_DIR))

from datavest_env import read_env_file  # noqa: E402


def load_verifier() -> Any:
    path = DEPLOY_DIR / "verify-s3-access.py"
    spec = importlib.util.spec_from_file_location("verify_s3_access", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the S3 verifier.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ClientError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(f"provider error {code} secret-value")
        self.response = {"Error": {"Code": code}}


class RecordingClient:
    def __init__(self, *, fail_head_after_put: bool = False) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.calls: list[str] = []
        self.fail_head_after_put = fail_head_after_put

    def head_bucket(self, *, Bucket: str) -> None:
        self.calls.append("head_bucket")
        assert Bucket == "datavest"

    def list_objects_v2(self, *, Bucket: str, MaxKeys: int, Prefix: str = "") -> dict[str, int]:
        self.calls.append("list_objects")
        assert Bucket == "datavest"
        assert MaxKeys == 1
        count = sum(1 for bucket, key in self.objects if bucket == Bucket and key.startswith(Prefix))
        return {"KeyCount": count}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:
        self.calls.append("put_object")
        assert ContentType == "text/plain"
        self.objects[(Bucket, Key)] = Body

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, int]:
        self.calls.append("head_object")
        if self.fail_head_after_put:
            raise ClientError("InternalError")
        try:
            body = self.objects[(Bucket, Key)]
        except KeyError as error:
            raise ClientError("NoSuchKey") from error
        return {"ContentLength": len(body)}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, BytesIO]:
        self.calls.append("get_object")
        return {"Body": BytesIO(self.objects[(Bucket, Key)])}

    def delete_object(self, *, Bucket: str, Key: str) -> None:
        self.calls.append("delete_object")
        self.objects.pop((Bucket, Key), None)


def test_env_parser_reads_quotes_without_shell_expansion(tmp_path: Path) -> None:
    env_file = tmp_path / "production.env"
    env_file.write_text(
        """
# comment
DATAVEST_S3_BUCKET=datavest
URL="https://example.test/path?a=1&b=2"
PASSWORD='literal $HOME $(whoami) `hostname` ${TOKEN}'
""".strip(),
        encoding="utf-8",
    )

    values = read_env_file(env_file)

    assert values == {
        "DATAVEST_S3_BUCKET": "datavest",
        "URL": "https://example.test/path?a=1&b=2",
        "PASSWORD": "literal $HOME $(whoami) `hostname` ${TOKEN}",
    }


def test_env_parser_rejects_invalid_or_duplicate_names(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.env"
    invalid.write_text("bad-name=value\n", encoding="utf-8")
    with pytest.raises(ValueError, match="variable name"):
        read_env_file(invalid)

    duplicate = tmp_path / "duplicate.env"
    duplicate.write_text("KEY=one\nKEY=two\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate"):
        read_env_file(duplicate)


def test_verify_access_writes_reads_and_removes_one_smoke_object() -> None:
    verifier = load_verifier()
    client = RecordingClient()

    result = verifier.verify_access(
        client,
        "datavest",
        "_deployment-smoke/test.txt",
        b"ok\n",
    )

    assert result == {
        "head_bucket": "ok",
        "list_objects": "ok",
        "put_object": "ok",
        "head_object": "ok",
        "get_object": "ok",
        "delete_object": "ok",
        "deleted_object_absent": "ok",
    }
    assert client.objects == {}
    assert client.calls == [
        "head_bucket",
        "list_objects",
        "put_object",
        "head_object",
        "get_object",
        "delete_object",
        "list_objects",
    ]


def test_verify_access_cleans_up_after_post_put_failure() -> None:
    verifier = load_verifier()
    client = RecordingClient(fail_head_after_put=True)

    with pytest.raises(ClientError):
        verifier.verify_access(
            client,
            "datavest",
            "_deployment-smoke/test.txt",
            b"ok\n",
        )

    assert client.objects == {}
    assert client.calls[-1] == "delete_object"


def test_anonymous_read_must_be_denied() -> None:
    verifier = load_verifier()

    class DeniedClient:
        def get_object(self, **_kwargs: object) -> None:
            raise ClientError("AccessDenied")

    class PublicClient:
        def get_object(self, **_kwargs: object) -> dict[str, BytesIO]:
            return {"Body": BytesIO(b"public")}

    assert verifier.anonymous_read_is_denied(DeniedClient(), "datavest", "key") is True
    assert verifier.anonymous_read_is_denied(PublicClient(), "datavest", "key") is False


def test_cli_failure_output_never_contains_provider_exception_or_secret() -> None:
    verifier = load_verifier()
    output = StringIO()

    exit_code = verifier.run(
        ["--env-file", "missing.env", "--bucket", "datavest"],
        client_factory=lambda _settings: (_ for _ in ()).throw(
            RuntimeError("secret-value provider details")
        ),
        output=output,
    )

    assert exit_code == 1
    assert output.getvalue() == "s3_access=failed\n"
