from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from smart_insights.artifacts import (
    ArtifactIntegrityError,
    ArtifactStorageUnavailable,
    S3ArtifactStore,
)
from smart_insights.contracts import RawSnapshot


class MissingObjectError(RuntimeError):
    response = {"Error": {"Code": "NoSuchKey"}}


class RecordingS3Client:
    def __init__(
        self,
        *,
        put_error: Exception | None = None,
        corrupt_head: bool = False,
    ) -> None:
        self.put_error = put_error
        self.corrupt_head = corrupt_head
        self.objects: dict[tuple[str, str], dict[str, Any]] = {}
        self.put_calls: list[dict[str, Any]] = []

    def put_object(self, **kwargs: Any) -> dict[str, str]:
        if self.put_error is not None:
            raise self.put_error
        body = kwargs["Body"].read()
        recorded = {**kwargs, "Body": body}
        self.put_calls.append(recorded)
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = recorded
        return {"ETag": '"test"'}

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError as error:
            raise MissingObjectError("missing") from error
        return {
            "ContentLength": len(stored["Body"]) + (1 if self.corrupt_head else 0),
            "Metadata": stored["Metadata"],
            "ContentType": stored["ContentType"],
            "ContentEncoding": stored["ContentEncoding"],
        }

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError as error:
            raise MissingObjectError("missing") from error
        return {"Body": BytesIO(stored["Body"])}


def snapshot(content: bytes = b"payload") -> RawSnapshot:
    return RawSnapshot(
        content=content,
        content_type="application/json",
        source_url="https://example.com/data",
        effective_at=None,
        published_at=None,
        observed_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
    )


def test_s3_store_puts_private_content_and_removes_verified_spool(
    tmp_path: Path,
) -> None:
    client = RecordingS3Client()
    store = S3ArtifactStore(client, "datavest", tmp_path, "smart-insights/raw")

    stored = store.write(snapshot(), "farside-btc-etf")

    assert stored.locator == (
        "s3://datavest/smart-insights/raw/farside-btc-etf/2026/08/"
        f"{stored.content_hash}.json.gz"
    )
    assert client.put_calls[0]["Bucket"] == "datavest"
    assert "ACL" not in client.put_calls[0]
    assert client.put_calls[0]["ContentType"] == "application/json"
    assert client.put_calls[0]["ContentEncoding"] == "gzip"
    assert (
        client.put_calls[0]["Metadata"]["content-sha256"]
        == stored.content_hash
    )
    assert not list(tmp_path.rglob("*.tmp"))
    assert store.read(stored.locator) == b"payload"


def test_s3_store_reuses_an_existing_verified_content_addressed_object(
    tmp_path: Path,
) -> None:
    client = RecordingS3Client()
    store = S3ArtifactStore(client, "datavest", tmp_path)

    first = store.write(snapshot(), "example-source")
    second = store.write(snapshot(), "example-source")

    assert second == first
    assert len(client.put_calls) == 1
    assert not list(tmp_path.rglob("*.tmp"))


def test_s3_store_keeps_spool_when_upload_fails(tmp_path: Path) -> None:
    client = RecordingS3Client(put_error=RuntimeError("offline with secret-value"))
    store = S3ArtifactStore(client, "datavest", tmp_path)

    with pytest.raises(ArtifactStorageUnavailable, match="upload") as error:
        store.write(snapshot(), "example-source")

    assert "secret-value" not in str(error.value)
    assert len(list(tmp_path.rglob("*.tmp"))) == 1


def test_s3_store_keeps_spool_when_remote_verification_fails(tmp_path: Path) -> None:
    client = RecordingS3Client(corrupt_head=True)
    store = S3ArtifactStore(client, "datavest", tmp_path)

    with pytest.raises(ArtifactIntegrityError, match="metadata"):
        store.write(snapshot(), "example-source")

    assert len(list(tmp_path.rglob("*.tmp"))) == 1


@pytest.mark.parametrize(
    "locator",
    [
        "https://example.com/public.json.gz",
        "s3://other/smart-insights/raw/a/2026/08/" + "a" * 64 + ".json.gz",
        "s3://datavest/../outside/" + "a" * 64 + ".json.gz",
        "s3://datavest/other-prefix/a/2026/08/" + "a" * 64 + ".json.gz",
    ],
)
def test_s3_store_rejects_foreign_or_unsafe_locators(
    locator: str, tmp_path: Path
) -> None:
    store = S3ArtifactStore(RecordingS3Client(), "datavest", tmp_path)

    with pytest.raises(ValueError):
        store.read(locator)


def test_s3_store_rejects_tampered_uncompressed_content(tmp_path: Path) -> None:
    client = RecordingS3Client()
    store = S3ArtifactStore(client, "datavest", tmp_path)
    stored = store.write(snapshot(), "example-source")
    ((bucket, key), record) = next(iter(client.objects.items()))
    record["Body"] = record["Body"] + b"tampered"

    with pytest.raises(ArtifactIntegrityError, match="checksum"):
        store.read(stored.locator)

    assert bucket == "datavest"
    assert key.endswith(".json.gz")


def test_s3_store_bounds_content_after_gzip_expansion(tmp_path: Path) -> None:
    client = RecordingS3Client()
    store = S3ArtifactStore(
        client,
        "datavest",
        tmp_path,
        max_response_bytes=100,
    )
    stored = store.write(snapshot(b"x" * 1_000), "example-source")

    with pytest.raises(ArtifactIntegrityError, match="size limit"):
        store.read(stored.locator)
