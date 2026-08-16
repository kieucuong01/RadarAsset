# Selective Dataset Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer only verified active daily raw datasets from local PostgreSQL through private S3 into production PostgreSQL without recrawling history or adding S3 to the web request path.

**Architecture:** A small `dataset_sync` package owns deterministic manifests, eligibility, compressed CSV encoding, S3 transport, and PostgreSQL import. One CLI exposes scan, export, import dry-run/apply, and verify operations; each dataset is validated and committed independently, and the existing production daily ingestion remains responsible for future increments.

**Tech Stack:** Python 3.12, psycopg 3, PostgreSQL, boto3, gzip/csv/json/hashlib from the standard library, pytest.

## Global Constraints

- Only active `1d` datasets with `adjustment_policy = 'raw'` are eligible.
- Allowed markets are exactly `vn_equity`, `crypto_spot`, and `metal_spot`.
- Allowed providers are exactly `binance-public`, `dukascopy-public`, `vnstock-kbs-free`, and `vnstock-vci-free`.
- Quality status must be `passed` or `warning`; `failed` is rejected.
- Coverage must not be more than three days stale at scan time.
- Fixture, demo, seeded, simulated, or otherwise synthetic sources must be rejected.
- PostgreSQL remains the only runtime store used by charts, APIs, and backtests.
- S3 is a private transfer and recovery layer under `operations/dataset-sync/<batch-id>/`.
- Local UUIDs must never be copied; map by provider code, canonical key, timeframe, and adjustment policy.
- Use single-part `put_object`, verify byte length and SHA-256 with `head_object`, and publish the complete manifest last.
- Import must be idempotent and atomic per dataset.
- Do not enqueue strategy or AI fan-out inside bootstrap import transactions.
- Delete superseded unreferenced versions immediately; never cascade-delete user or investment history.
- Process one dataset at a time and remove its VPS spool file in `finally`.
- Do not add PyArrow, Parquet, a recurring local sync timer, or any new production secret.
- Never print or commit database URLs, S3 access keys, or secret values.

---

## File Structure

- Create `quant-worker/dataset_sync/__init__.py`: public package boundary.
- Create `quant-worker/dataset_sync/contracts.py`: immutable manifest and outcome types plus strict JSON parsing.
- Create `quant-worker/dataset_sync/codec.py`: deterministic gzip CSV encoding/decoding and digest calculation.
- Create `quant-worker/dataset_sync/selection.py`: eligibility policy and PostgreSQL scanner.
- Create `quant-worker/dataset_sync/exporter.py`: per-dataset export and batch assembly.
- Create `quant-worker/dataset_sync/storage.py`: private S3 upload/download and locator allowlisting.
- Create `quant-worker/dataset_sync/importer.py`: manifest validation, PostgreSQL publication, pruning, and verification.
- Create `quant-worker/dataset_sync/config.py`: strict allowlisted env-file loading without secret logging.
- Create `quant-worker/sync_dataset_bootstrap.py`: operator CLI for `scan`, `export`, `import`, and `verify`.
- Modify `quant-worker/backtest/publication.py`: allow bootstrap publication to suppress strategy fan-out.
- Create focused tests in `quant-worker/tests/test_dataset_sync_*.py`.
- Modify `quant-worker/README.md`: local operator commands and safety boundary.
- Modify `docs/operations/deployment-runbook.md`: production bootstrap and verification procedure.
- Create `docs/verification/2026-08-17-selective-dataset-bootstrap.md` during the real run: sanitized evidence only.

---

### Task 1: Manifest Contracts and Deterministic Dataset Codec

**Files:**
- Create: `quant-worker/dataset_sync/__init__.py`
- Create: `quant-worker/dataset_sync/contracts.py`
- Create: `quant-worker/dataset_sync/codec.py`
- Test: `quant-worker/tests/test_dataset_sync_contracts.py`
- Test: `quant-worker/tests/test_dataset_sync_codec.py`

**Interfaces:**
- Produces: `DatasetKey`, `QualityIssueRecord`, `DatasetManifest`, `BatchManifest`, `PackageDigest`, `DatasetSyncError`.
- Produces: `encode_dataset(rows: Iterable[Bar], destination: Path) -> PackageDigest`.
- Produces: `decode_dataset(path: Path, manifest: DatasetManifest, *, max_rows: int = 250_000) -> tuple[Bar, ...]`.
- Produces: `serialize_manifest(manifest: BatchManifest) -> bytes` and `parse_manifest(payload: bytes) -> BatchManifest`.

`PackageDigest` is a frozen value with `row_count: int`, `coverage_start: datetime`, `coverage_end: datetime`, `dataset_checksum: str`, `compressed_bytes: int`, and `compressed_sha256: str`.

- [ ] **Step 1: Write failing manifest contract tests**

```python
from datetime import datetime, timezone

import pytest

from dataset_sync.contracts import BatchManifest, DatasetKey, DatasetManifest


def test_manifest_rejects_non_daily_or_adjusted_dataset() -> None:
    with pytest.raises(ValueError, match="daily raw"):
        DatasetKey(
            provider_code="binance-public",
            canonical_key="CRYPTO:BTC",
            timeframe="1h",
            adjustment_policy="raw",
        )


def test_batch_manifest_requires_unique_dataset_keys_and_complete_state() -> None:
    dataset = sample_dataset_manifest()
    with pytest.raises(ValueError, match="unique"):
        BatchManifest(
            schema_version=1,
            batch_id="20260817T010203Z-0123456789ab",
            exported_at=datetime(2026, 8, 17, 1, 2, 3, tzinfo=timezone.utc),
            status="complete",
            datasets=(dataset, dataset),
        )
```

Define `sample_dataset_manifest()` inside the test module with one valid `binance-public` BTC daily manifest; do not add test-only constructors to production dataclasses.

- [ ] **Step 2: Run the contract tests and confirm RED**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path 'quant-worker').Path
python -m pytest quant-worker/tests/test_dataset_sync_contracts.py -q
```

Expected: collection fails because `dataset_sync.contracts` does not exist.

- [ ] **Step 3: Implement immutable contracts and strict JSON parsing**

Use frozen, slotted dataclasses. Validate every enum, timestamp, digest, count, S3 key, and dataset uniqueness in `__post_init__`. The public shapes are:

```python
@dataclass(frozen=True, slots=True)
class DatasetKey:
    provider_code: str
    canonical_key: str
    timeframe: Literal["1d"]
    adjustment_policy: Literal["raw"]


@dataclass(frozen=True, slots=True)
class QualityIssueRecord:
    code: str
    severity: str
    timestamp: datetime | None
    classification: str | None
    range_start: datetime | None
    range_end: datetime | None
    details: dict[str, Any]


@dataclass(frozen=True, slots=True)
class DatasetManifest:
    key: DatasetKey
    symbol: str
    asset_name: str
    market: Literal["vn_equity", "crypto_spot", "metal_spot"]
    venue: str
    currency: str
    timezone_name: str
    maximum_leverage: str
    provider_name: str
    provider_symbol: str
    terms_url: str | None
    coverage_start: datetime
    coverage_end: datetime
    row_count: int
    missing_bar_count: int
    quality_status: Literal["passed", "warning"]
    quality_summary: dict[str, Any]
    quality_issues: tuple[QualityIssueRecord, ...]
    source_metadata: dict[str, Any]
    dataset_checksum: str
    object_key: str
    compressed_bytes: int
    compressed_sha256: str


@dataclass(frozen=True, slots=True)
class BatchManifest:
    schema_version: Literal[1]
    batch_id: str
    exported_at: datetime
    status: Literal["complete"]
    datasets: tuple[DatasetManifest, ...]
```

`parse_manifest` must reject unknown top-level or dataset fields rather than silently ignoring schema drift. JSON uses `sort_keys=True`, `ensure_ascii=False`, and compact separators.

- [ ] **Step 4: Write failing deterministic codec tests**

```python
def test_codec_is_deterministic_and_decimal_exact(tmp_path: Path) -> None:
    first = tmp_path / "first.csv.gz"
    second = tmp_path / "second.csv.gz"
    bars = sample_bars(close="123.45678901", volume="987.6543")

    digest_a = encode_dataset(bars, first)
    digest_b = encode_dataset(bars, second)

    assert first.read_bytes() == second.read_bytes()
    assert digest_a == digest_b
    assert decode_dataset(first, sample_manifest(digest_a)) == tuple(bars)


def test_decoder_rejects_duplicate_timestamp_before_publication(tmp_path: Path) -> None:
    package = write_raw_package(tmp_path, duplicate_timestamp_rows())
    with pytest.raises(DatasetSyncError, match="strictly increasing"):
        decode_dataset(package.path, package.manifest)
```

- [ ] **Step 5: Run codec tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_codec.py -q
```

Expected: fails because codec functions are undefined.

- [ ] **Step 6: Implement deterministic gzip CSV encoding and bounded decoding**

The CSV header is exactly:

```text
timestamp,open,high,low,close,volume,source
```

Write gzip with `mtime=0`, UTF-8, `newline=""`, and `lineterminator="\n"`. Serialize UTC timestamps with `Z`; serialize `Decimal` with fixed database storage precision and no float conversion. Decoder requirements:

```python
CSV_FIELDS = ("timestamp", "open", "high", "low", "close", "volume", "source")
MAX_DATASET_ROWS = 250_000

def decode_dataset(path: Path, manifest: DatasetManifest, *, max_rows: int = MAX_DATASET_ROWS) -> tuple[Bar, ...]:
    if path.stat().st_size != manifest.compressed_bytes:
        raise DatasetSyncError("Compressed byte length does not match the manifest.")
    if sha256_file(path) != manifest.compressed_sha256:
        raise DatasetSyncError("Compressed SHA-256 does not match the manifest.")
    rows = tuple(_iter_validated_rows(path, manifest, max_rows=max_rows))
    if len(rows) != manifest.row_count:
        raise DatasetSyncError("Dataset row count does not match the manifest.")
    if canonical_bar_checksum(list(rows)) != manifest.dataset_checksum:
        raise DatasetSyncError("Dataset checksum does not match the manifest.")
    return rows
```

Reject non-UTC timestamps, duplicate/out-of-order timestamps, empty source, invalid decimal, non-finite decimal, negative volume, and invalid OHLC ordering.

- [ ] **Step 7: Run focused tests and commit Task 1**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_contracts.py quant-worker/tests/test_dataset_sync_codec.py -q
git diff --check
```

Expected: all focused tests pass and `git diff --check` is clean.

Commit:

```powershell
git add -- quant-worker/dataset_sync quant-worker/tests/test_dataset_sync_contracts.py quant-worker/tests/test_dataset_sync_codec.py
git commit -m "Add deterministic dataset sync packages"
```

---

### Task 2: Eligibility Scanner and Local Exporter

**Files:**
- Create: `quant-worker/dataset_sync/selection.py`
- Create: `quant-worker/dataset_sync/exporter.py`
- Test: `quant-worker/tests/test_dataset_sync_selection.py`
- Test: `quant-worker/tests/test_dataset_sync_exporter.py`

**Interfaces:**
- Consumes: `DatasetKey`, `DatasetManifest`, `BatchManifest`, `encode_dataset` from Task 1.
- Produces: `EligibilityCandidate`, `EligibilityDecision`, `EligibilityReport`.
- Produces: `classify_candidate(candidate: EligibilityCandidate, *, now: datetime) -> EligibilityDecision`.
- Produces: `scan_datasets(connection: psycopg.Connection[Any], *, now: datetime) -> EligibilityReport`.
- Produces: `export_batch(connection, report: EligibilityReport, spool_root: Path, *, now: datetime) -> ExportedBatch`.

- [ ] **Step 1: Write failing policy tests for every reason code**

```python
@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"timeframe": "1h"}, "skipped_invalid"),
        ({"adjustment_policy": "total_return"}, "skipped_invalid"),
        ({"market": "us_equity"}, "skipped_invalid"),
        ({"provider_code": "unknown"}, "skipped_untrusted"),
        ({"quality_status": "failed"}, "skipped_quality"),
        ({"coverage_end": datetime(2026, 8, 10, tzinfo=timezone.utc)}, "skipped_stale"),
        ({"source_metadata": {"mode": "fixture"}}, "skipped_untrusted"),
        ({"actual_row_count": 9, "declared_row_count": 10}, "skipped_invalid"),
    ],
)
def test_candidate_rejection_is_stable(changes: dict[str, object], reason: str) -> None:
    candidate = replace(valid_candidate(), **changes)
    decision = classify_candidate(candidate, now=datetime(2026, 8, 17, tzinfo=timezone.utc))
    assert decision.status == reason
```

Also test that `warning` remains eligible and preserves its issue metadata.

- [ ] **Step 2: Run selection tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_selection.py -q
```

Expected: fails because `dataset_sync.selection` does not exist.

- [ ] **Step 3: Implement the policy as a pure classifier**

Use constants imported from `backtest.daily_scope`:

```python
ALLOWED_MARKETS = frozenset({"vn_equity", "crypto_spot", "metal_spot"})
ALLOWED_QUALITY = frozenset({"passed", "warning"})
UNTRUSTED_MARKERS = frozenset({"fixture", "research_fixture", "demo", "seed", "seeded", "simulated", "synthetic"})
MAX_STALENESS = timedelta(days=3)
```

Scan only active rows, but classify every returned candidate again in Python. Normalize metadata recursively to lowercase strings and reject an exact marker token; do not reject a legitimate URL merely because an unrelated substring contains `demo`.

- [ ] **Step 4: Write failing PostgreSQL scanner/export tests**

Use a fake cursor for SQL contract tests and a temporary directory for export behavior:

```python
def test_export_writes_only_eligible_datasets_and_keeps_warning(tmp_path: Path) -> None:
    connection = FakeDatasetConnection([passed_record(), stale_record(), warning_record()])
    report = scan_datasets(connection, now=NOW)
    batch = export_batch(connection, report, tmp_path, now=NOW)

    assert [item.status for item in report.decisions] == [
        "eligible", "skipped_stale", "eligible"
    ]
    assert len(batch.manifest.datasets) == 2
    assert batch.manifest.datasets[1].quality_status == "warning"
    assert all(path.suffixes == [".csv", ".gz"] for path in batch.dataset_paths)
```

Add tests proving rows are selected by `dataset_version_id`, ordered by `ts`, and quality issues are loaded from `data_quality_issues`.

- [ ] **Step 5: Run exporter tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_selection.py quant-worker/tests/test_dataset_sync_exporter.py -q
```

Expected: exporter tests fail before implementation.

- [ ] **Step 6: Implement scanner SQL and exporter**

The scanner query must join `assets`, `provider_instruments`, `data_providers`, `datasets`, and active `dataset_versions`, and return the declared plus actual row counts:

```sql
SELECT version.id AS dataset_version_id,
       provider.code AS provider_code,
       provider.name AS provider_name,
       provider.terms_url,
       instrument.provider_symbol,
       asset.symbol,
       asset.canonical_key,
       asset.name AS asset_name,
       asset.market,
       asset.venue,
       asset.currency,
       asset.timezone,
       asset.max_leverage,
       dataset.timeframe,
       dataset.adjustment_policy,
       version.coverage_start,
       version.coverage_end,
       version.row_count AS declared_row_count,
       COUNT(bar.id)::int AS actual_row_count,
       version.missing_bar_count,
       version.quality_status,
       version.quality_summary,
       version.source_metadata,
       version.checksum,
       ARRAY_AGG(DISTINCT bar.source) FILTER (WHERE bar.source IS NOT NULL) AS row_sources
FROM dataset_versions AS version
JOIN datasets AS dataset ON dataset.id = version.dataset_id
JOIN assets AS asset ON asset.id = dataset.asset_id
JOIN provider_instruments AS instrument
  ON instrument.asset_id = asset.id AND instrument.provider_id = version.provider_id
JOIN data_providers AS provider ON provider.id = version.provider_id
LEFT JOIN dataset_bars AS bar ON bar.dataset_version_id = version.id
WHERE version.is_active = true
GROUP BY version.id, provider.id, instrument.id, asset.id, dataset.id
ORDER BY asset.market, asset.symbol;
```

Use deterministic batch IDs `YYYYMMDDTHHMMSSZ-<first-12-of-manifest-input-sha>`. Dataset object names use a safe symbol plus the dataset checksum; never interpolate a raw canonical key into a filesystem path.

- [ ] **Step 7: Run focused tests and commit Task 2**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_selection.py quant-worker/tests/test_dataset_sync_exporter.py -q
git diff --check
```

Commit:

```powershell
git add -- quant-worker/dataset_sync/selection.py quant-worker/dataset_sync/exporter.py quant-worker/tests/test_dataset_sync_selection.py quant-worker/tests/test_dataset_sync_exporter.py
git commit -m "Select verified daily datasets for export"
```

---

### Task 3: Private S3 Transfer With Complete-Manifest-Last Publication

**Files:**
- Create: `quant-worker/dataset_sync/storage.py`
- Test: `quant-worker/tests/test_dataset_sync_storage.py`

**Interfaces:**
- Consumes: `ExportedBatch`, `BatchManifest`, `serialize_manifest`, and digest helpers.
- Produces: `StoredBatch(manifest_locator: str, manifest_sha256: str, dataset_count: int, compressed_bytes: int)`.
- Produces: `DatasetSyncS3Store.upload_batch(batch: ExportedBatch) -> StoredBatch`.
- Produces: `DatasetSyncS3Store.read_manifest(locator: str) -> BatchManifest`.
- Produces: `DatasetSyncS3Store.download_dataset(manifest: DatasetManifest, destination: Path) -> Path`.

- [ ] **Step 1: Write failing S3 ordering, retry, and locator tests**

```python
def test_upload_verifies_each_dataset_and_writes_manifest_last(tmp_path: Path) -> None:
    client = RecordingS3Client()
    store = DatasetSyncS3Store(client, "datavest", prefix="operations/dataset-sync")

    result = store.upload_batch(exported_batch(tmp_path))

    assert client.put_keys[-1].endswith("/manifest.json")
    assert client.head_keys == client.put_keys
    assert result.manifest_locator.startswith("s3://datavest/operations/dataset-sync/")


@pytest.mark.parametrize(
    "locator",
    [
        "s3://other/operations/dataset-sync/x/manifest.json",
        "s3://datavest/operations/dataset-sync/../x/manifest.json",
        "s3://datavest/other/x/manifest.json",
        "https://example.test/manifest.json",
    ],
)
def test_manifest_locator_is_allowlisted(locator: str) -> None:
    with pytest.raises(ValueError, match="configured dataset sync prefix"):
        store().read_manifest(locator)
```

Add cases for mismatched S3 byte length, mismatched SHA metadata, failed dataset upload, pre-existing exact object, and failed manifest upload.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_storage.py -q
```

Expected: fails because `DatasetSyncS3Store` does not exist.

- [ ] **Step 3: Implement single-part upload and streaming download**

Use these metadata fields:

```python
DATASET_METADATA = {
    "sha256": manifest.compressed_sha256,
    "dataset-checksum": manifest.dataset_checksum,
    "batch-id": batch.manifest.batch_id,
}
MANIFEST_METADATA = {
    "sha256": hashlib.sha256(manifest_payload).hexdigest(),
    "batch-id": batch.manifest.batch_id,
    "complete": "true",
}
```

`put_object` receives an open file handle for dataset objects and bytes for the small manifest. `head_object` must match `ContentLength` and lowercase metadata. `get_object` downloads in 1 MiB chunks, enforces the declared length, fsyncs the destination, and removes partial files in `finally`.

- [ ] **Step 4: Run tests and commit Task 3**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_storage.py -q
git diff --check
```

Commit:

```powershell
git add -- quant-worker/dataset_sync/storage.py quant-worker/tests/test_dataset_sync_storage.py
git commit -m "Transfer dataset batches through private S3"
```

---

### Task 4: Idempotent PostgreSQL Import and Safe Superseded-Version Pruning

**Files:**
- Modify: `quant-worker/backtest/publication.py`
- Create: `quant-worker/dataset_sync/importer.py`
- Test: `quant-worker/tests/test_dataset_sync_importer.py`
- Test: `quant-worker/tests/test_dataset_sync_importer_integration.py`
- Modify: `quant-worker/tests/test_publication.py`

**Interfaces:**
- Consumes: `DatasetSyncS3Store`, `BatchManifest`, `DatasetManifest`, `decode_dataset`.
- Modifies: `PostgresDatasetPublisher.publish_if_changed(prepared, *, enqueue_evaluations: bool = True) -> PublicationResult`.
- Modifies: `PostgresDatasetPublisher.publish(prepared, *, enqueue_evaluations: bool = True) -> dict[str, Any]`.
- Produces: `DatasetImportOutcome`, `BatchImportReport`.
- Produces: `PostgresDatasetImporter.dry_run(manifest: BatchManifest) -> BatchImportReport`.
- Produces: `PostgresDatasetImporter.apply(manifest: BatchManifest, store: DatasetSyncS3Store, spool_root: Path) -> BatchImportReport`.
- Produces: `PostgresDatasetImporter.verify(manifest: BatchManifest) -> BatchImportReport`.

Use these exact outcome fields:

```python
@dataclass(frozen=True, slots=True)
class DatasetImportOutcome:
    key: DatasetKey
    status: Literal[
        "would_import",
        "already_present",
        "imported",
        "failed",
    ]
    dataset_version_id: str | None
    row_count: int
    pruned_versions: int
    retained_versions: int
    prune_status: Literal["not_applicable", "pruned", "retained_due_to_reference"]
    error_code: str | None


@dataclass(frozen=True, slots=True)
class BatchImportReport:
    batch_id: str
    mode: Literal["dry_run", "apply", "verify"]
    outcomes: tuple[DatasetImportOutcome, ...]
    counts: dict[str, int]
```

- [ ] **Step 1: Write a failing publisher test for fan-out suppression**

```python
def test_bootstrap_publication_can_suppress_strategy_fanout(monkeypatch) -> None:
    enqueued: list[str] = []
    monkeypatch.setattr(publication, "enqueue_strategy_evaluations", lambda *_: enqueued.append("job"))

    publisher = PostgresDatasetPublisher(fake_connection())
    publisher.publish(prepared_dataset(), enqueue_evaluations=False)

    assert enqueued == []
```

- [ ] **Step 2: Run the publisher test and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_publication.py -q
```

Expected: fails because `enqueue_evaluations` is not accepted.

- [ ] **Step 3: Add the backward-compatible publisher flag**

Keep the default `True` so normal ingestion behavior does not change:

```python
def publish_if_changed(
    self,
    prepared: PreparedDatasetPublication,
    *,
    enqueue_evaluations: bool = True,
) -> PublicationResult:
    active = self.load_active(prepared.asset, prepared.timeframe, prepared.adjustment_policy)
    if active is None or active.checksum != prepared.checksum:
        published = self.publish(
            prepared,
            enqueue_evaluations=enqueue_evaluations,
        )
        return PublicationResult(
            status="succeeded",
            dataset_version_id=str(published["datasetVersionId"]),
            version=int(published["version"]),
            checksum=str(published["checksum"]),
            row_count=int(published["rowCount"]),
            missing_bar_count=int(published["missingBarCount"]),
            quality_status=str(published["qualityStatus"]),
        )
    return PublicationResult(
        status="unchanged",
        dataset_version_id=active.dataset_version_id,
        version=active.version,
        checksum=active.checksum,
        row_count=len(active.rows),
        missing_bar_count=active.missing_bar_count,
        quality_status=active.quality_status,
    )

def publish(self, prepared: PreparedDatasetPublication, *, enqueue_evaluations: bool = True) -> dict[str, Any]:
    if enqueue_evaluations:
        enqueue_strategy_evaluations(cursor, version_id, asset_id)
```

Make only three production edits: add the keyword-only flag to both signatures, pass it from `publish_if_changed` to `publish`, and guard the existing `enqueue_strategy_evaluations(cursor, version_id, asset_id)` call. Keep every existing SQL statement and return field unchanged.

- [ ] **Step 4: Write failing importer unit tests**

```python
def test_dry_run_does_not_download_or_write() -> None:
    store = RecordingStore()
    repository = RecordingImportRepository(active_checksums={KEY: "old"})
    report = PostgresDatasetImporter(repository).dry_run(batch_manifest())
    assert report.outcomes[0].status == "would_import"
    assert store.calls == []
    assert repository.writes == []


def test_apply_is_idempotent_and_cleans_spool(tmp_path: Path) -> None:
    importer, repository, store = importer_fixture(tmp_path)
    first = importer.apply(MANIFEST, store, tmp_path)
    second = importer.apply(MANIFEST, store, tmp_path)
    assert first.outcomes[0].status == "imported"
    assert second.outcomes[0].status == "already_present"
    assert list(tmp_path.iterdir()) == []
```

Add cases for digest failure, decoder failure, publication failure, partial batch continuation, and sanitized error codes.

- [ ] **Step 5: Write failing PostgreSQL integration tests**

Integration setup must use `TEST_DATABASE_URL` and unique symbols/providers. Required cases:

```python
def test_import_maps_different_uuids_and_activates_only_after_validation(pg_case) -> None:
    destination_asset_id = pg_case.seed_destination_asset(canonical_key="QA:BTC")
    manifest = pg_case.package(canonical_key="QA:BTC", source_asset_id=uuid4())
    report = pg_case.apply(manifest)
    assert report.outcomes[0].status == "imported"
    assert pg_case.active_asset_id("QA:BTC") == destination_asset_id
    assert pg_case.active_checksum("QA:BTC") == manifest.datasets[0].dataset_checksum


def test_failed_import_preserves_prior_active_version(pg_case) -> None:
    prior_id = pg_case.seed_active_version(canonical_key="QA:FAIL", close="100")
    manifest = pg_case.corrupt_package(canonical_key="QA:FAIL")
    report = pg_case.apply(manifest)
    assert report.outcomes[0].status == "failed"
    assert pg_case.active_version_id("QA:FAIL") == prior_id


def test_repeated_import_creates_no_duplicate_version_or_bars(pg_case) -> None:
    manifest = pg_case.package(canonical_key="QA:IDEMPOTENT")
    assert pg_case.apply(manifest).outcomes[0].status == "imported"
    assert pg_case.apply(manifest).outcomes[0].status == "already_present"
    assert pg_case.version_count("QA:IDEMPOTENT") == 1
    assert pg_case.bar_count("QA:IDEMPOTENT") == manifest.datasets[0].row_count


def test_prune_deletes_unreferenced_inactive_version_and_bars(pg_case) -> None:
    old_id = pg_case.seed_active_version(canonical_key="QA:PRUNE", close="100")
    report = pg_case.apply(pg_case.package(canonical_key="QA:PRUNE", close="101"))
    assert report.outcomes[0].pruned_versions == 1
    assert not pg_case.version_exists(old_id)
    assert pg_case.bar_count_for_version(old_id) == 0


def test_prune_retains_version_referenced_by_quant_run_leg_without_cascade(pg_case) -> None:
    old_id = pg_case.seed_active_version(canonical_key="QA:REFERENCED", close="100")
    quant_run_leg_id = pg_case.seed_quant_run_leg(dataset_version_id=old_id)
    report = pg_case.apply(pg_case.package(canonical_key="QA:REFERENCED", close="101"))
    assert report.outcomes[0].retained_versions == 1
    assert pg_case.version_exists(old_id)
    assert pg_case.quant_run_leg_exists(quant_run_leg_id)
```

Implement the `pg_case` fixture in the same test module. It owns a real psycopg connection, creates unique provider/asset/strategy/organization rows, builds real S3 package files in `tmp_path`, exposes exactly the helper methods used above, and deletes only its unique organization, asset, and provider rows in `finally`. The referenced-version case must use a real `quant_run_leg` restrictive foreign key and assert the user-owned relation survives.

- [ ] **Step 6: Run importer tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_importer.py -q
$env:TEST_DATABASE_URL=$env:DATABASE_URL_TEST
python -m pytest quant-worker/tests/test_dataset_sync_importer_integration.py -q
```

Expected: unit tests fail before importer implementation; integration tests skip only when no test database is configured.

- [ ] **Step 7: Implement import, verification, and prune behavior**

Convert decoded rows and manifest metadata to `PreparedDatasetPublication` and run `prepare_dataset_publication` again. Require the recomputed checksum, coverage, row count, missing-bar count, and quality status to match the manifest before any database write.

Before publication, resolve `assets.canonical_key` in production. If it exists, require its symbol and market to match the manifest and use that destination symbol; if it does not exist, require that the manifest symbol is not already owned by a different canonical key. Resolve the provider by unique `data_providers.code`. This preflight is what guarantees business-key remapping even though local and production UUIDs differ.

Apply each dataset in its own transaction:

```python
with connection.transaction():
    result = publisher.publish_if_changed(prepared, enqueue_evaluations=False)
    if result.status == "succeeded":
        prune = repository.prune_superseded_versions(
            dataset_version_id=result.dataset_version_id,
            dataset_key=manifest.key,
        )
```

Prune one inactive version per nested transaction/savepoint. Let PostgreSQL cascade only `dataset_bars` and `data_quality_issues`; restrictive business references must raise `ForeignKeyViolation`, roll back that savepoint, and produce `retained_due_to_reference`. `SetNull` operational ingestion references may be cleared by the database without deleting their parent history.

`verify` queries active versions by business key and compares checksum, row count, coverage, quality status, and actual bar count. It performs no writes.

- [ ] **Step 8: Run focused and integration tests, then commit Task 4**

Run:

```powershell
python -m pytest quant-worker/tests/test_publication.py quant-worker/tests/test_dataset_sync_importer.py -q
python -m pytest quant-worker/tests/test_dataset_sync_importer_integration.py -q
git diff --check
```

Commit:

```powershell
git add -- quant-worker/backtest/publication.py quant-worker/dataset_sync/importer.py quant-worker/tests/test_publication.py quant-worker/tests/test_dataset_sync_importer.py quant-worker/tests/test_dataset_sync_importer_integration.py
git commit -m "Import dataset batches idempotently"
```

---

### Task 5: Safe Operator CLI and Runbook

**Files:**
- Create: `quant-worker/dataset_sync/config.py`
- Create: `quant-worker/sync_dataset_bootstrap.py`
- Create: `quant-worker/tests/test_dataset_sync_cli.py`
- Modify: `quant-worker/README.md`
- Modify: `docs/operations/deployment-runbook.md`

**Interfaces:**
- Consumes all Task 1-4 interfaces.
- Produces CLI commands `scan`, `export`, `import`, and `verify`.
- Produces `load_dataset_sync_settings(env_file: Path, environ: Mapping[str, str]) -> DatasetSyncSettings`.

- [ ] **Step 1: Write failing configuration and CLI safety tests**

```python
def test_settings_require_only_existing_database_and_s3_keys(tmp_path: Path) -> None:
    env_file = write_env(tmp_path, valid_settings())
    settings = load_dataset_sync_settings(env_file, {})
    assert settings.bucket == "datavest"
    assert "secret" not in repr(settings)


def test_import_requires_explicit_apply_and_defaults_to_dry_run(capsys) -> None:
    exit_code = main(["import", "--manifest", VALID_LOCATOR, "--env-file", "test.env"])
    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["mode"] == "dry_run"


def test_fatal_output_never_contains_database_or_s3_secret(capsys) -> None:
    exit_code = main(["scan", "--env-file", "broken.env"])
    output = capsys.readouterr().out
    assert exit_code == 1
    assert "postgresql://" not in output
    assert "secret-access" not in output
```

- [ ] **Step 2: Run CLI tests and confirm RED**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_cli.py -q
```

Expected: fails because config and CLI modules do not exist.

- [ ] **Step 3: Implement strict settings and CLI commands**

The CLI syntax is exactly:

```text
sync_dataset_bootstrap.py scan   --env-file PATH
sync_dataset_bootstrap.py export --env-file PATH --spool-root PATH
sync_dataset_bootstrap.py import --env-file PATH --manifest S3_LOCATOR [--apply]
sync_dataset_bootstrap.py verify --env-file PATH --manifest S3_LOCATOR [--backtest-symbol SYMBOL]
```

`scan` connects only to PostgreSQL. `export` requires PostgreSQL plus S3 and removes a successful local spool batch after upload verification. `import` is dry-run unless `--apply` is present. `verify` checks the database and runs a read-only MA crossover smoke using `run_strategy`, `MovingAverageCrossoverStrategy(fast_period=5, slow_period=20)`, and at least 22 bars from the requested or first eligible imported symbol.

Construct the read-only smoke exactly from the active PostgreSQL snapshot:

```python
strategy = MovingAverageCrossoverStrategy(fast_period=5, slow_period=20)
config = EngineConfig(
    initial_capital=Decimal("100000000"),
    fast_period=5,
    slow_period=20,
    fee_bps=Decimal("15"),
    slippage_bps=Decimal("5"),
    leverage_by_asset={symbol: Decimal("1")},
    market_by_asset={symbol: market},
    strategy_hash="dataset-sync-ma-smoke-v1",
    dataset_checksums={symbol: active.checksum},
    strategy=strategy,
)
result = run_strategy({symbol: list(active.rows)}, config, strategy=strategy)
if not result.summary or result.manifest["datasetChecksums"][symbol] != active.checksum:
    raise DatasetSyncError("Backtest smoke did not consume the active dataset checksum.")
```

All output is compact JSON with stable keys. Exit codes:

- `0`: complete success or clean dry-run.
- `2`: partial batch failure or retained referenced version.
- `1`: configuration, manifest, connection, or fatal integrity failure.

- [ ] **Step 4: Document the exact local and production workflow**

Add these commands to `quant-worker/README.md`:

```powershell
$env:PYTHONPATH=(Resolve-Path 'quant-worker').Path
python quant-worker/sync_dataset_bootstrap.py scan --env-file .env.local
python quant-worker/sync_dataset_bootstrap.py export --env-file .env.local --spool-root .local-data/dataset-sync
```

Add these commands to `docs/operations/deployment-runbook.md`:

```bash
sudo -u datavest /opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/quant-worker/sync_dataset_bootstrap.py import \
  --env-file /opt/datavest/shared/.env \
  --manifest 's3://datavest/operations/dataset-sync/<batch-id>/manifest.json'

sudo -u datavest /opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/quant-worker/sync_dataset_bootstrap.py import \
  --env-file /opt/datavest/shared/.env \
  --manifest 's3://datavest/operations/dataset-sync/<batch-id>/manifest.json' \
  --apply
```

State explicitly that S3 is not used by web requests and no timer is installed.

- [ ] **Step 5: Run CLI tests, all focused sync tests, and commit Task 5**

Run:

```powershell
python -m pytest quant-worker/tests/test_dataset_sync_contracts.py quant-worker/tests/test_dataset_sync_codec.py quant-worker/tests/test_dataset_sync_selection.py quant-worker/tests/test_dataset_sync_exporter.py quant-worker/tests/test_dataset_sync_storage.py quant-worker/tests/test_dataset_sync_importer.py quant-worker/tests/test_dataset_sync_cli.py -q
git diff --check
```

Commit:

```powershell
git add -- quant-worker/dataset_sync/config.py quant-worker/sync_dataset_bootstrap.py quant-worker/tests/test_dataset_sync_cli.py quant-worker/README.md docs/operations/deployment-runbook.md
git commit -m "Add dataset bootstrap operator workflow"
```

---

### Task 6: Full Verification, Release, and Production Bootstrap

**Files:**
- Create: `docs/verification/2026-08-17-selective-dataset-bootstrap.md`

**Interfaces:**
- Consumes the complete CLI and existing DataVest release pipeline.
- Produces pushed SHA, deployed SHA, S3 manifest locator/digest, local eligibility evidence, production import report, database verification, backtest smoke, HTTP evidence, latency comparison, and disk/spool evidence.

- [ ] **Step 1: Run the full relevant local verification suite**

Run:

```powershell
npm run test:python
npm run lint
npm run typecheck
git diff --check
```

Expected: all source checks pass. Record unrelated environment skips separately; do not describe a skip as a pass.

- [ ] **Step 2: Run the local eligibility dry-run and review every category**

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path 'quant-worker').Path
python quant-worker/sync_dataset_bootstrap.py scan --env-file .env.local
```

Record only counts and stable reason codes. Confirm selected data contains no hourly, adjusted, fixture, failed-quality, or stale dataset.

- [ ] **Step 3: Export the approved local batch to private S3**

Run:

```powershell
python quant-worker/sync_dataset_bootstrap.py export --env-file .env.local --spool-root .local-data/dataset-sync
```

Record the returned manifest locator, manifest SHA-256, dataset count, total rows, and compressed bytes. Do not record credentials or the database URL. Confirm `.local-data/dataset-sync` contains no completed batch payload after verified upload.

- [ ] **Step 4: Commit implementation and push the exact branch SHA**

Run:

```powershell
git status --short
git log -6 --oneline
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: local `HEAD` equals `origin/main`; only intended commits are present.

- [ ] **Step 5: Build and deploy the exact pushed SHA through the existing release path**

Use the existing GitHub artifact and `/usr/local/sbin/deploy-datavest` workflow from `docs/operations/deployment-runbook.md`. Record separately:

- pushed SHA
- successful build run and artifact checksum
- resolved `/opt/datavest/current` release SHA
- active services
- loopback readiness
- public HTTPS readiness

Do not call a push or successful build a production deployment.

- [ ] **Step 6: Capture production baseline before importing**

On the VPS, record sanitized counts and resources:

```bash
df -h /opt/datavest
du -sh /opt/datavest/shared/spool /opt/datavest/releases
find /opt/datavest/shared/spool -maxdepth 2 -type f -printf '%p %s\n'
curl --fail --silent --show-error -o /dev/null -w '%{http_code} %{time_total}\n' https://datavest.vn/
curl --fail --silent --show-error -o /dev/null -w '%{http_code} %{time_total}\n' https://datavest.vn/api/health/ready
```

Use a read-only SQL audit to record assets, active daily datasets, active bars, coverage by market, and inactive versions. Do not print the connection URL.

- [ ] **Step 7: Run production import dry-run and then apply**

Run the documented import command without `--apply`; require exit `0` and review `would_import`, `already_present`, and all rejection reasons. Then rerun with `--apply`.

Expected apply behavior:

- each eligible dataset is `imported` or `already_present`;
- a per-dataset failure does not deactivate the prior version;
- any `retained_due_to_reference` is reported, not hidden;
- no strategy/AI fan-out is enqueued by the bootstrap;
- exit `0` for full success or `2` for an explicitly documented partial result.

- [ ] **Step 8: Verify idempotency, database truth, and a real engine read**

Run the same import command with `--apply` again. Require zero new versions and all successful datasets to report `already_present`.

Run:

```bash
sudo -u datavest /opt/datavest/shared/python-venv/bin/python \
  /opt/datavest/current/quant-worker/sync_dataset_bootstrap.py verify \
  --env-file /opt/datavest/shared/.env \
  --manifest 's3://datavest/operations/dataset-sync/<batch-id>/manifest.json' \
  --backtest-symbol BTC
```

Require matching checksums/counts/coverage/quality for every imported dataset and a successful read-only MA crossover engine result.

- [ ] **Step 9: Verify web health, latency, and VPS cleanup**

Repeat baseline HTTP timing, service status, disk usage, and spool inspection. Require:

- public and loopback HTTP 200;
- no material latency regression attributable to the import;
- no dataset transfer file in the VPS spool;
- no superseded unreferenced dataset version;
- daily ingestion timer remains enabled and unchanged;
- no S3 request appears in the normal web/API request path.

Use the existing in-app browser for guest and authenticated product checks when an account is available. If no production membership exists, record that authenticated browser proof is unavailable rather than fabricating it.

- [ ] **Step 10: Write sanitized evidence and commit it**

Create `docs/verification/2026-08-17-selective-dataset-bootstrap.md` with:

- implementation and deployed SHA
- test command outcomes
- manifest locator and digest
- eligible/skipped/imported/already-present/failed counts
- production row counts and coverage
- idempotent rerun evidence
- backtest smoke result
- service/HTTP/latency evidence
- before/after disk and spool evidence
- any retained referenced version or unavailable authenticated check

Commit:

```powershell
git add -- docs/verification/2026-08-17-selective-dataset-bootstrap.md
git commit -m "Record selective dataset bootstrap evidence"
git push origin main
```

---

## Final Completion Gate

Do not declare completion until the evidence distinguishes all of the following:

1. Local eligibility and export truth.
2. Private S3 object and manifest integrity.
3. Pushed Git SHA and successful build artifact.
4. Active VPS release SHA and service health.
5. Production PostgreSQL checksum, row-count, coverage, and idempotency truth.
6. Real backtest-engine read from an imported dataset.
7. Public HTTP and browser behavior.
8. VPS disk/spool cleanup and superseded-version status.
