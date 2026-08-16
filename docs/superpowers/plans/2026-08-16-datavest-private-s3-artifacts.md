# DataVest Private S3 Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Smart Insights raw snapshots durably in the private Vietnix `datavest` bucket while preserving deterministic content addressing, local-test behavior, integrity checks, and explicit unavailable states.

**Architecture:** Keep the current filesystem `ArtifactStore` as the development default and introduce an environment-selected S3 implementation behind a small protocol. The S3 store compresses to a bounded local spool, uses a single `PutObject`, verifies remote length and checksum metadata, then returns an `s3://` locator and removes the spool file. Reads validate bucket, prefix, gzip content, and uncompressed SHA-256 before returning evidence.

**Tech Stack:** Python 3.12, boto3/botocore, gzip, hashlib, pathlib, pytest, PostgreSQL locator fields, Vietnix S3-compatible object storage.

## Global Constraints

- The production bucket is private and named exactly `datavest`.
- Browser code must never receive S3 credentials or permanent public object URLs.
- Production S3 values use DataVest-specific environment names even though their values originate from the Radar BDS server environment during provisioning.
- Use single-request `PutObject`; do not use multipart `upload_file` for these compressed raw artifacts.
- Preserve filesystem storage as the default for development and tests.
- Do not migrate `QuantRunArtifact.payload` out of PostgreSQL in this project.
- Never invent or substitute raw evidence when S3 is unavailable or integrity validation fails.
- A spool file is deleted only after remote metadata verification succeeds.

---

### Task 1: Artifact backend protocol and environment factory

**Files:**
- Modify: `quant-worker/smart_insights/artifacts.py`
- Create: `quant-worker/tests/test_artifact_store_factory.py`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ArtifactBackend(Protocol)` with `write(snapshot: RawSnapshot, source_code: str) -> StoredArtifact` and `read(locator: str) -> bytes`.
- Preserves: `ArtifactStore(root: Path)` as the filesystem implementation used by existing callers and tests.
- Produces: `artifact_store_from_env(env: Mapping[str, str] = os.environ) -> ArtifactBackend`.
- Produces environment selector: `SMART_INSIGHTS_ARTIFACT_BACKEND=filesystem|s3`.

- [ ] **Step 1: Write failing factory tests**

```python
from pathlib import Path
import pytest

from smart_insights.artifacts import ArtifactStore, artifact_store_from_env


def test_factory_defaults_to_filesystem(tmp_path: Path) -> None:
    store = artifact_store_from_env(
        {"SMART_INSIGHTS_ARTIFACT_ROOT": str(tmp_path)}
    )
    assert isinstance(store, ArtifactStore)


def test_factory_rejects_unknown_backend() -> None:
    with pytest.raises(ValueError, match="SMART_INSIGHTS_ARTIFACT_BACKEND"):
        artifact_store_from_env({"SMART_INSIGHTS_ARTIFACT_BACKEND": "public-http"})


@pytest.mark.parametrize(
    "missing",
    [
        "DATAVEST_S3_ENDPOINT_URL",
        "DATAVEST_S3_BUCKET",
        "DATAVEST_S3_ACCESS_KEY_ID",
        "DATAVEST_S3_SECRET_ACCESS_KEY",
        "SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT",
    ],
)
def test_s3_factory_requires_every_private_setting(missing: str, tmp_path: Path) -> None:
    env = s3_env(tmp_path)
    del env[missing]
    with pytest.raises(ValueError, match=missing):
        artifact_store_from_env(env)
```

- [ ] **Step 2: Run the factory test and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_artifact_store_factory.py`

Expected: FAIL because `artifact_store_from_env` does not exist.

- [ ] **Step 3: Add the protocol and strict selector**

```python
from collections.abc import Mapping
from typing import Protocol


class ArtifactBackend(Protocol):
    def write(self, snapshot: RawSnapshot, source_code: str) -> StoredArtifact: ...
    def read(self, locator: str) -> bytes: ...


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
        return ArtifactStore(Path(env.get(
            "SMART_INSIGHTS_ARTIFACT_ROOT", ".local-data/smart-insights"
        )))
    if backend != "s3":
        raise ValueError("SMART_INSIGHTS_ARTIFACT_BACKEND must be filesystem or s3.")
    return S3ArtifactStore.from_settings(
        endpoint_url=_required(env, "DATAVEST_S3_ENDPOINT_URL"),
        bucket=_required(env, "DATAVEST_S3_BUCKET"),
        access_key_id=_required(env, "DATAVEST_S3_ACCESS_KEY_ID"),
        secret_access_key=_required(env, "DATAVEST_S3_SECRET_ACCESS_KEY"),
        spool_root=Path(_required(env, "SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT")),
        prefix=env.get("DATAVEST_S3_ARTIFACT_PREFIX", "smart-insights/raw"),
    )
```

Define `S3ArtifactStore` in Task 2; during RED/GREEN work, a minimal constructor declaration is sufficient only within the same commit and must not be committed while tests fail.

- [ ] **Step 4: Document the environment contract**

Add non-secret examples to `.env.example`:

```dotenv
SMART_INSIGHTS_ARTIFACT_BACKEND=filesystem
SMART_INSIGHTS_ARTIFACT_SPOOL_ROOT=.local-data/smart-insights-spool
DATAVEST_S3_ENDPOINT_URL=
DATAVEST_S3_BUCKET=datavest
DATAVEST_S3_ACCESS_KEY_ID=
DATAVEST_S3_SECRET_ACCESS_KEY=
DATAVEST_S3_ARTIFACT_PREFIX=smart-insights/raw
```

- [ ] **Step 5: Run focused and existing filesystem tests**

Run: `npm run test:python -- quant-worker/tests/test_artifact_store_factory.py quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: PASS, including existing atomic write, traversal, and hash-mismatch tests.

- [ ] **Step 6: Commit the backend boundary**

```bash
git add .env.example quant-worker/smart_insights/artifacts.py quant-worker/tests/test_artifact_store_factory.py
git commit -m "refactor: select Smart Insights artifact backend"
```

---

### Task 2: Private S3 write, verification, and read integrity

**Files:**
- Modify: `quant-worker/smart_insights/artifacts.py`
- Create: `quant-worker/tests/test_s3_artifact_store.py`
- Modify: `quant-worker/requirements.txt`

**Interfaces:**
- Produces: `S3ArtifactStore(client, bucket: str, spool_root: Path, prefix: str = "smart-insights/raw")`.
- Produces: `S3ArtifactStore.from_settings(...)` creating a boto3 client with the explicit endpoint and credentials.
- Produces locator: `s3://datavest/smart-insights/raw/<source>/<yyyy>/<mm>/<sha256>.json.gz`.
- Consumes an S3 client supporting `head_object`, `put_object`, and `get_object`.

- [ ] **Step 1: Write failing S3 happy-path tests with a fake client**

```python
def test_s3_store_puts_private_content_and_removes_verified_spool(tmp_path: Path) -> None:
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
    assert client.put_calls[0]["Metadata"]["content-sha256"] == stored.content_hash
    assert not list(tmp_path.rglob("*.tmp"))
    assert store.read(stored.locator) == b"payload"
```

The fake stores exact object bytes, metadata, content type, and content encoding in memory and returns a streaming body compatible with `get_object`.

- [ ] **Step 2: Write failing safety and outage tests**

```python
def test_s3_store_keeps_spool_when_put_fails(tmp_path: Path) -> None:
    client = RecordingS3Client(put_error=RuntimeError("offline"))
    store = S3ArtifactStore(client, "datavest", tmp_path)
    with pytest.raises(ArtifactStorageUnavailable, match="upload"):
        store.write(snapshot(), "farside-btc-etf")
    assert len(list(tmp_path.rglob("*.tmp"))) == 1


@pytest.mark.parametrize(
    "locator",
    [
        "https://example.com/public.json.gz",
        "s3://other/smart-insights/raw/a/2026/08/" + "a" * 64 + ".json.gz",
        "s3://datavest/../outside/" + "a" * 64 + ".json.gz",
    ],
)
def test_s3_store_rejects_foreign_or_unsafe_locators(locator: str, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        S3ArtifactStore(RecordingS3Client(), "datavest", tmp_path).read(locator)
```

Also test wrong remote `ContentLength`, missing `content-sha256`, mismatched uncompressed content, and a key outside `smart-insights/raw/`.

- [ ] **Step 3: Run S3 tests and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_s3_artifact_store.py -q`

Expected: FAIL because `S3ArtifactStore` and `ArtifactStorageUnavailable` do not exist.

- [ ] **Step 4: Implement deterministic gzip spooling**

Create the same source/year/month/hash suffix as the filesystem store. Write gzip with `mtime=0`, flush and `fsync`, and keep the temporary file under the configured spool root. Before upload, an existing object may be reused only when `head_object` returns matching `ContentLength` and `Metadata["content-sha256"]`.

```python
client.put_object(
    Bucket=self._bucket,
    Key=key,
    Body=spool_file,
    ContentType=snapshot.content_type or "application/octet-stream",
    ContentEncoding="gzip",
    Metadata={
        "content-sha256": content_hash,
        "source-code": source_code,
    },
)
```

Do not pass `ACL`. Wrap client errors in `ArtifactStorageUnavailable("Artifact upload is unavailable.")` without embedding endpoint, access key, secret, or provider response bodies.

- [ ] **Step 5: Implement verified read**

Parse the URI with `urlsplit`. Require scheme `s3`, exact bucket, exact configured prefix, safe POSIX segments, `.json.gz`, and a 64-character lowercase SHA filename. Bound compressed reads using `SMART_INSIGHTS_MAX_RESPONSE_BYTES`; decompress, calculate SHA-256, and raise `ArtifactIntegrityError` on gzip or checksum failure.

```python
response = self._client.get_object(Bucket=self._bucket, Key=key)
compressed = response["Body"].read(self._max_response_bytes + 1)
if len(compressed) > self._max_response_bytes:
    raise ArtifactIntegrityError("Artifact exceeds the configured size limit.")
content = gzip.decompress(compressed)
if hashlib.sha256(content).hexdigest() != expected_hash:
    raise ArtifactIntegrityError("Artifact checksum does not match its locator.")
```

- [ ] **Step 6: Add the runtime dependency**

Add `boto3>=1.35,<2` to `quant-worker/requirements.txt`. Do not add moto; the fake client keeps unit tests offline and deterministic.

- [ ] **Step 7: Run all artifact tests and verify GREEN**

Run:

```bash
npm run test:python -- quant-worker/tests/test_s3_artifact_store.py quant-worker/tests/test_artifact_store_factory.py quant-worker/tests/test_smart_insights_foundation.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit the S3 store**

```bash
git add quant-worker/requirements.txt quant-worker/smart_insights/artifacts.py quant-worker/tests/test_s3_artifact_store.py
git commit -m "feat: store Smart Insights evidence in private S3"
```

---

### Task 3: Wire collectors through the backend factory

**Files:**
- Modify: `quant-worker/collect_smart_insights.py`
- Modify: `quant-worker/tests/test_smart_insights_foundation.py`
- Modify: `quant-worker/README.md`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Replaces direct production construction of `ArtifactStore(Path(...))` with `artifact_store_from_env()`.
- Preserves explicit `ArtifactBackend` dependency injection in `run_collection`, `run_calendar_schedule`, and pipeline helpers.
- Preserves filesystem behavior when the selector is absent.

- [ ] **Step 1: Write a failing collector factory test**

Monkeypatch `collect_smart_insights.artifact_store_from_env` to return a recording backend, call `main(["daily", "--dry-run", "--env-file", str(env_file)])`, and assert the factory is invoked only for execution paths that persist artifacts. Add a live-path test using a fake database connection and collectors so no network access occurs.

```python
backend = RecordingArtifactBackend()
monkeypatch.setattr(
    collect_smart_insights,
    "artifact_store_from_env",
    lambda: backend,
)
assert collect_smart_insights.main(["daily", "--env-file", str(env_file)]) == 0
assert backend.writes
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_smart_insights_foundation.py -q`

Expected: the new assertion FAILS while `main` still constructs the filesystem store directly.

- [ ] **Step 3: Replace direct construction with the factory**

Import `ArtifactBackend` and `artifact_store_from_env`, update helper annotations from the concrete class to the protocol, and construct the backend after `load_dotenv(args.env_file)` has loaded the selected environment. Do not create an S3 client for briefing-only, replay, or dry-run paths that do not persist raw evidence.

- [ ] **Step 4: Document local and production modes**

Add exact local filesystem and production S3 environment examples, locator formats, failure behavior, spool retention, and a warning that production credentials must not be pasted into `.env.example` or Markdown.

- [ ] **Step 5: Run collector and integration-safe tests**

Run:

```bash
npm run test:python -- quant-worker/tests/test_smart_insights_foundation.py quant-worker/tests/test_smart_insights_crypto_collectors.py quant-worker/tests/test_smart_insights_macro_collectors.py -q
```

Expected: PASS without internet access.

- [ ] **Step 6: Commit collector wiring**

```bash
git add quant-worker/collect_smart_insights.py quant-worker/tests/test_smart_insights_foundation.py quant-worker/README.md docs/operations/smart-insights-runbook.md
git commit -m "feat: select production artifact storage from environment"
```

---

### Task 4: Credential-safe live S3 verification utility

**Files:**
- Create: `deploy/linux/datavest_env.py`
- Create: `deploy/linux/verify-s3-access.py`
- Create: `quant-worker/tests/test_verify_s3_access.py`
- Modify: `docs/operations/smart-insights-runbook.md`

**Interfaces:**
- Produces CLI: `python deploy/linux/verify-s3-access.py --env-file <path> --bucket datavest`.
- Produces: `read_env_file(path: Path) -> dict[str, str]`, accepting simple shell-style `KEY=value`, single-quoted, and double-quoted values without command expansion.
- Performs: head bucket, list with `MaxKeys=1`, put/head/get/delete of one `_deployment-smoke/` object, post-delete absence check, and anonymous-read denial check.
- Emits: status names only; never endpoint credentials, signed URLs, object contents, or exception response bodies.

- [ ] **Step 1: Write failing CLI unit tests**

Test `read_env_file` against quoted URLs/passwords and assert it treats `$()`, backticks, and `${NAME}` as literal text rather than executing or expanding them. Inject a fake client into `verify_access(client, bucket, key, payload)` and assert the exact operation order and cleanup-on-error:

```python
result = verify_access(client, "datavest", "_deployment-smoke/test.txt", b"ok\n")
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
```

Test that a put or head failure still calls delete when an object may have been created and that formatted output excludes fake secret strings.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run test:python -- quant-worker/tests/test_verify_s3_access.py -q`

Expected: FAIL because the verification utility is absent.

- [ ] **Step 3: Implement the utility**

Use `argparse`, `read_env_file`, `uuid4`, and boto3. The parser ignores blank/comment lines, splits once on `=`, validates names with `^[A-Z][A-Z0-9_]*$`, strips one matching quote pair, and performs no interpolation. Restrict keys to `_deployment-smoke/access-check-<uuid>.txt`; require the bucket argument to equal the configured `DATAVEST_S3_BUCKET`; call `delete_object` in `finally` after any successful put. Return exit 1 with a single sanitized `s3_access=failed` line on client errors.

Use an unsigned boto3 client for the anonymous read check. An HTTP 403/AccessDenied is PASS; a successful body read is FAIL and still triggers authenticated cleanup.

- [ ] **Step 4: Run unit tests and the approved live smoke test**

Run unit tests first. Then on the VPS using the DataVest environment:

```bash
/opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/deploy/linux/verify-s3-access.py \
  --env-file /opt/datavest/shared/.env \
  --bucket datavest
```

Expected: every authenticated operation is `ok`, anonymous read is denied, and the smoke prefix contains no remaining object.

- [ ] **Step 5: Commit the verifier**

```bash
git add deploy/linux/datavest_env.py deploy/linux/verify-s3-access.py quant-worker/tests/test_verify_s3_access.py docs/operations/smart-insights-runbook.md
git commit -m "ops: verify private DataVest S3 access"
```

---

### Task 5: S3 integration verification gate

**Files:**
- Modify only files from Tasks 1-4 if verification exposes a defect.

**Interfaces:**
- Produces: tested filesystem and S3 artifact backends with a private-bucket smoke proof.

- [ ] **Step 1: Run all Python tests**

Run: `npm run test:python`

Expected: pytest exits 0.

- [ ] **Step 2: Run TypeScript and formatting gates affected by environment documentation**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test`

Expected: every command exits 0.

- [ ] **Step 3: Verify dependency and secret scope**

Run:

```bash
git grep -nE 'AKIA|RADAR_S3_SECRET|DEEPSEEK_API_KEY=.+' -- ':!package-lock.json'
git diff --check
git status --short
```

Expected: the secret-pattern search returns no credential value, diff check exits 0, and only intentional files are present before their commit.
