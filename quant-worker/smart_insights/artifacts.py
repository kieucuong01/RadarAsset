from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import gzip
import hashlib
from io import BytesIO
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
from typing import Any, Protocol
from urllib.parse import urlsplit

from .contracts import RawSnapshot


_SOURCE_CODE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ArtifactIntegrityError(RuntimeError):
    pass


class ArtifactStorageUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class StoredArtifact:
    locator: str
    content_hash: str
    byte_count: int


class ArtifactBackend(Protocol):
    def write(self, snapshot: RawSnapshot, source_code: str) -> StoredArtifact: ...

    def read(self, locator: str) -> bytes: ...


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def write(self, snapshot: RawSnapshot, source_code: str) -> StoredArtifact:
        if not _SOURCE_CODE.fullmatch(source_code):
            raise ValueError("Source code is not safe for artifact storage.")
        content_hash = hashlib.sha256(snapshot.content).hexdigest()
        locator = PurePosixPath(
            source_code,
            f"{snapshot.observed_at.year:04d}",
            f"{snapshot.observed_at.month:02d}",
            f"{content_hash}.json.gz",
        )
        target = self._resolve_locator(locator.as_posix())
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                delete=False, dir=target.parent, suffix=".tmp"
            ) as temporary:
                temporary_name = temporary.name
                with gzip.GzipFile(fileobj=temporary, mode="wb", mtime=0) as compressed:
                    compressed.write(snapshot.content)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, target)
        finally:
            if temporary_name is not None:
                Path(temporary_name).unlink(missing_ok=True)
        return StoredArtifact(
            locator=locator.as_posix(),
            content_hash=content_hash,
            byte_count=len(snapshot.content),
        )

    def read(self, locator: str) -> bytes:
        target = self._resolve_locator(locator)
        expected_hash = target.name.removesuffix(".json.gz")
        if not target.name.endswith(".json.gz") or not _SHA256.fullmatch(expected_hash):
            raise ValueError("Artifact locator does not contain a valid checksum.")
        try:
            with gzip.open(target, "rb") as compressed:
                content = compressed.read()
        except OSError as error:
            raise ArtifactIntegrityError("Artifact checksum could not be verified.") from error
        if hashlib.sha256(content).hexdigest() != expected_hash:
            raise ArtifactIntegrityError("Artifact checksum does not match its locator.")
        return content

    def _resolve_locator(self, locator: str) -> Path:
        relative = PurePosixPath(locator)
        if relative.is_absolute() or not relative.parts:
            raise ValueError("Artifact locator must stay inside the configured root.")
        candidate = self._root.joinpath(*relative.parts).resolve()
        try:
            candidate.relative_to(self._root)
        except ValueError as error:
            raise ValueError("Artifact locator must stay inside the configured root.") from error
        return candidate


class S3ArtifactStore:
    def __init__(
        self,
        client: Any,
        bucket: str,
        spool_root: Path,
        prefix: str = "smart-insights/raw",
        *,
        max_response_bytes: int = 20_000_000,
    ) -> None:
        if not bucket or "/" in bucket:
            raise ValueError("S3 artifact bucket is invalid.")
        prefix_parts = prefix.strip("/").split("/")
        if not prefix_parts or any(part in {"", ".", ".."} for part in prefix_parts):
            raise ValueError("S3 artifact prefix is invalid.")
        if max_response_bytes <= 0:
            raise ValueError("S3 artifact size limit must be positive.")
        self._client = client
        self._bucket = bucket
        self._spool_root = spool_root.resolve()
        self._prefix = "/".join(prefix_parts)
        self._max_response_bytes = max_response_bytes

    @classmethod
    def from_settings(
        cls,
        *,
        endpoint_url: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        spool_root: Path,
        prefix: str,
        max_response_bytes: int = 20_000_000,
    ) -> S3ArtifactStore:
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="us-east-1",
        )
        return cls(
            client,
            bucket,
            spool_root,
            prefix,
            max_response_bytes=max_response_bytes,
        )

    def write(self, snapshot: RawSnapshot, source_code: str) -> StoredArtifact:
        if not _SOURCE_CODE.fullmatch(source_code):
            raise ValueError("Source code is not safe for artifact storage.")
        content_hash = hashlib.sha256(snapshot.content).hexdigest()
        key = PurePosixPath(
            self._prefix,
            source_code,
            f"{snapshot.observed_at.year:04d}",
            f"{snapshot.observed_at.month:02d}",
            f"{content_hash}.json.gz",
        ).as_posix()
        locator = f"s3://{self._bucket}/{key}"
        self._spool_root.mkdir(parents=True, exist_ok=True)
        spool_name: str | None = None
        verified = False
        try:
            with tempfile.NamedTemporaryFile(
                delete=False,
                dir=self._spool_root,
                suffix=".tmp",
            ) as temporary:
                spool_name = temporary.name
                with gzip.GzipFile(fileobj=temporary, mode="wb", mtime=0) as compressed:
                    compressed.write(snapshot.content)
                temporary.flush()
                os.fsync(temporary.fileno())
            spool_path = Path(spool_name)
            compressed_size = spool_path.stat().st_size
            state = self._remote_state(key, compressed_size, content_hash)
            if state == "mismatch":
                raise ArtifactIntegrityError(
                    "Artifact remote metadata does not match its locator."
                )
            if state == "missing":
                try:
                    with spool_path.open("rb") as body:
                        self._client.put_object(
                            Bucket=self._bucket,
                            Key=key,
                            Body=body,
                            ContentType=snapshot.content_type,
                            ContentEncoding="gzip",
                            Metadata={
                                "content-sha256": content_hash,
                                "source-code": source_code,
                            },
                        )
                except Exception as error:
                    raise ArtifactStorageUnavailable(
                        "Artifact upload is unavailable."
                    ) from error
                if self._remote_state(key, compressed_size, content_hash) != "verified":
                    raise ArtifactIntegrityError(
                        "Artifact remote metadata could not be verified."
                    )
            verified = True
            return StoredArtifact(
                locator=locator,
                content_hash=content_hash,
                byte_count=len(snapshot.content),
            )
        finally:
            if verified and spool_name is not None:
                Path(spool_name).unlink(missing_ok=True)

    def read(self, locator: str) -> bytes:
        key, expected_hash = self._parse_locator(locator)
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            content_body = response["Body"]
            compressed = content_body.read(self._max_response_bytes + 1)
        except Exception as error:
            raise ArtifactStorageUnavailable("Artifact read is unavailable.") from error
        if len(compressed) > self._max_response_bytes:
            raise ArtifactIntegrityError("Artifact exceeds the configured size limit.")
        try:
            with gzip.GzipFile(fileobj=BytesIO(compressed), mode="rb") as archive:
                content = archive.read(self._max_response_bytes + 1)
        except OSError as error:
            raise ArtifactIntegrityError(
                "Artifact checksum could not be verified."
            ) from error
        if len(content) > self._max_response_bytes:
            raise ArtifactIntegrityError("Artifact exceeds the configured size limit.")
        if hashlib.sha256(content).hexdigest() != expected_hash:
            raise ArtifactIntegrityError("Artifact checksum does not match its locator.")
        return content

    def _remote_state(
        self, key: str, compressed_size: int, content_hash: str
    ) -> str:
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)
        except Exception as error:
            code = str(
                getattr(error, "response", {}).get("Error", {}).get("Code", "")
            )
            if code in {"404", "NoSuchKey", "NotFound"}:
                return "missing"
            raise ArtifactStorageUnavailable(
                "Artifact metadata is unavailable."
            ) from error
        metadata = response.get("Metadata") or {}
        if (
            response.get("ContentLength") == compressed_size
            and metadata.get("content-sha256") == content_hash
        ):
            return "verified"
        return "mismatch"

    def _parse_locator(self, locator: str) -> tuple[str, str]:
        parsed = urlsplit(locator)
        if (
            parsed.scheme != "s3"
            or parsed.netloc != self._bucket
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Artifact locator does not belong to this S3 store.")
        key = parsed.path.removeprefix("/")
        parts = key.split("/")
        prefix_parts = self._prefix.split("/")
        if (
            not key
            or "%" in key
            or any(part in {"", ".", ".."} for part in parts)
            or parts[: len(prefix_parts)] != prefix_parts
        ):
            raise ValueError("Artifact locator must stay inside the configured prefix.")
        expected_hash = parts[-1].removesuffix(".json.gz")
        if not parts[-1].endswith(".json.gz") or not _SHA256.fullmatch(
            expected_hash
        ):
            raise ValueError("Artifact locator does not contain a valid checksum.")
        return key, expected_hash


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required for S3 artifact storage.")
    return value


def artifact_store_from_env(
    env: Mapping[str, str] = os.environ,
) -> ArtifactBackend:
    backend = env.get("SMART_INSIGHTS_ARTIFACT_BACKEND", "filesystem").strip().lower()
    if backend == "filesystem":
        return ArtifactStore(
            Path(
                env.get(
                    "SMART_INSIGHTS_ARTIFACT_ROOT",
                    ".local-data/smart-insights",
                )
            )
        )
    if backend != "s3":
        raise ValueError(
            "SMART_INSIGHTS_ARTIFACT_BACKEND must be filesystem or s3."
        )
    try:
        max_response_bytes = int(
            env.get("SMART_INSIGHTS_MAX_RESPONSE_BYTES", "20000000")
        )
    except ValueError as error:
        raise ValueError(
            "SMART_INSIGHTS_MAX_RESPONSE_BYTES must be an integer."
        ) from error
    return S3ArtifactStore.from_settings(
        endpoint_url=_required(env, "DATAVEST_S3_ENDPOINT_URL"),
        bucket=_required(env, "DATAVEST_S3_BUCKET"),
        access_key_id=_required(env, "DATAVEST_S3_ACCESS_KEY_ID"),
        secret_access_key=_required(env, "DATAVEST_S3_SECRET_ACCESS_KEY"),
        spool_root=Path(_required(env, "SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT")),
        prefix=env.get("DATAVEST_S3_ARTIFACT_PREFIX", "smart-insights/raw"),
        max_response_bytes=max_response_bytes,
    )
