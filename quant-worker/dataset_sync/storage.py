from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

from .contracts import BatchManifest, DatasetManifest, parse_manifest
from .exporter import ExportedBatch


class DatasetSyncStorageError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class StoredBatch:
    manifest_locator: str
    manifest_sha256: str
    dataset_count: int
    compressed_bytes: int


class DatasetSyncS3Store:
    def __init__(
        self,
        client: Any,
        bucket: str,
        *,
        prefix: str = "operations/dataset-sync",
    ) -> None:
        if not bucket or "/" in bucket:
            raise ValueError("Dataset sync bucket is invalid.")
        self._client = client
        self._bucket = bucket
        self._prefix = self._validate_prefix(prefix)

    @staticmethod
    def _validate_prefix(prefix: str) -> str:
        parts = prefix.strip("/").split("/")
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise ValueError("Dataset sync prefix is invalid.")
        return "/".join(parts)

    def _validate_key(self, key: str, *, manifest: bool = False) -> str:
        parts = PurePosixPath(key).parts
        prefix = tuple(self._prefix.split("/"))
        if (
            not key
            or "%" in key
            or any(part in {"", ".", ".."} for part in parts)
            or parts[: len(prefix)] != prefix
            or manifest and parts[-1] != "manifest.json"
        ):
            raise ValueError("Dataset sync locator must stay inside the configured dataset sync prefix.")
        return key

    def _head(self, key: str) -> dict[str, Any] | None:
        try:
            return self._client.head_object(Bucket=self._bucket, Key=key)
        except KeyError:
            return None
        except Exception as error:
            code = str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise DatasetSyncStorageError("Dataset sync object metadata is unavailable.") from error

    @staticmethod
    def _metadata(response: dict[str, Any]) -> dict[str, str]:
        return {str(key).lower(): str(value) for key, value in (response.get("Metadata") or {}).items()}

    def _matches(self, response: dict[str, Any], *, size: int, digest: str) -> bool:
        return response.get("ContentLength") == size and self._metadata(response).get("sha256") == digest

    def _upload_file(self, path: Path, key: str, *, metadata: dict[str, str], content_type: str) -> None:
        size = path.stat().st_size
        digest = metadata["sha256"]
        current = self._head(key)
        if current is not None:
            if self._matches(current, size=size, digest=digest):
                return
            raise DatasetSyncStorageError("Existing dataset sync object does not match immutable payload.")
        try:
            with path.open("rb") as body:
                self._client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=body,
                    ContentType=content_type,
                    Metadata=metadata,
                )
        except Exception as error:
            raise DatasetSyncStorageError("Dataset sync object upload failed.") from error
        verified = self._head(key)
        if verified is None or not self._matches(verified, size=size, digest=digest):
            raise DatasetSyncStorageError("Dataset sync object verification failed.")

    def _upload_bytes(self, payload: bytes, key: str, *, metadata: dict[str, str]) -> None:
        digest = metadata["sha256"]
        current = self._head(key)
        if current is not None:
            if self._matches(current, size=len(payload), digest=digest):
                return
            raise DatasetSyncStorageError("Existing dataset sync manifest does not match immutable payload.")
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=payload,
                ContentType="application/json",
                Metadata=metadata,
            )
        except Exception as error:
            raise DatasetSyncStorageError("Dataset sync manifest upload failed.") from error
        verified = self._head(key)
        if verified is None or not self._matches(verified, size=len(payload), digest=digest):
            raise DatasetSyncStorageError("Dataset sync manifest verification failed.")

    def upload_batch(self, batch: ExportedBatch) -> StoredBatch:
        if len(batch.manifest.datasets) != len(batch.dataset_paths):
            raise ValueError("Dataset sync batch package count is inconsistent.")
        for manifest, path in zip(batch.manifest.datasets, batch.dataset_paths, strict=True):
            key = self._validate_key(manifest.object_key)
            self._upload_file(
                path,
                key,
                metadata={
                    "sha256": manifest.compressed_sha256,
                    "dataset-checksum": manifest.dataset_checksum,
                    "batch-id": batch.manifest.batch_id,
                },
                content_type="application/gzip",
            )
        manifest_key = self._validate_key(
            f"{self._prefix}/{batch.manifest.batch_id}/manifest.json", manifest=True
        )
        manifest_digest = hashlib.sha256(batch.manifest_bytes).hexdigest()
        self._upload_bytes(
            batch.manifest_bytes,
            manifest_key,
            metadata={"sha256": manifest_digest, "batch-id": batch.manifest.batch_id, "complete": "true"},
        )
        return StoredBatch(
            manifest_locator=f"s3://{self._bucket}/{manifest_key}",
            manifest_sha256=manifest_digest,
            dataset_count=len(batch.manifest.datasets),
            compressed_bytes=sum(item.compressed_bytes for item in batch.manifest.datasets),
        )

    def _parse_manifest_locator(self, locator: str) -> str:
        parsed = urlsplit(locator)
        if parsed.scheme != "s3" or parsed.netloc != self._bucket or parsed.query or parsed.fragment:
            raise ValueError("Dataset sync manifest locator does not belong to this store.")
        return self._validate_key(parsed.path.removeprefix("/"), manifest=True)

    def _download(self, key: str, destination: Path, *, expected_size: int, expected_sha256: str) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        temporary.unlink(missing_ok=True)
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            if response.get("ContentLength") != expected_size:
                raise DatasetSyncStorageError("Dataset sync object length does not match manifest.")
            metadata = self._metadata(response)
            if metadata.get("sha256") != expected_sha256:
                raise DatasetSyncStorageError("Dataset sync object metadata does not match manifest.")
            body = response["Body"]
            with temporary.open("wb") as handle:
                while chunk := body.read(1024 * 1024):
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if temporary.stat().st_size != expected_size:
                raise DatasetSyncStorageError("Dataset sync download length verification failed.")
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected_sha256:
                raise DatasetSyncStorageError("Dataset sync download checksum verification failed.")
            os.replace(temporary, destination)
            return destination
        except DatasetSyncStorageError:
            raise
        except Exception as error:
            raise DatasetSyncStorageError("Dataset sync object download failed.") from error
        finally:
            temporary.unlink(missing_ok=True)

    def read_manifest(self, locator: str) -> BatchManifest:
        key = self._parse_manifest_locator(locator)
        response = self._head(key)
        if response is None or self._metadata(response).get("complete") != "true":
            raise DatasetSyncStorageError("Dataset sync manifest is not complete.")
        expected_size = int(response["ContentLength"])
        expected_sha256 = self._metadata(response).get("sha256", "")
        destination = Path.cwd() / ".dataset-sync-manifest.tmp"
        try:
            self._download(key, destination, expected_size=expected_size, expected_sha256=expected_sha256)
            return parse_manifest(destination.read_bytes())
        finally:
            destination.unlink(missing_ok=True)

    def download_dataset(self, manifest: DatasetManifest, destination: Path) -> Path:
        key = self._validate_key(manifest.object_key)
        return self._download(
            key,
            destination,
            expected_size=manifest.compressed_bytes,
            expected_sha256=manifest.compressed_sha256,
        )
