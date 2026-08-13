from __future__ import annotations

from dataclasses import dataclass
import gzip
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

from .contracts import RawSnapshot


_SOURCE_CODE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ArtifactIntegrityError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class StoredArtifact:
    locator: str
    content_hash: str
    byte_count: int


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
