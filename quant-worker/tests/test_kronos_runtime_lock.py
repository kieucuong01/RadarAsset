from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_runtime_lock_is_reproducible_and_optional() -> None:
    lock = json.loads((ROOT / "quant-worker/third_party/kronos.lock.json").read_text())

    assert lock["source"] == {
        "url": "https://github.com/shiyu-coder/Kronos.git",
        "revision": "67b630e67f6a18c9e9be918d9b4337c960db1e9a",
        "license": "MIT",
    }
    assert lock["model"]["revision"] == "901c26c1332695a2a8f243eb2f37243a37bea320"
    assert lock["tokenizer"]["revision"] == "0e0117387f39004a9016484a186a908917e22426"

    requirements = (ROOT / "quant-worker/requirements-kronos.txt").read_text()
    for dependency in (
        "torch==2.7.1",
        "einops==0.8.1",
        "huggingface-hub==0.33.1",
        "safetensors==0.6.2",
    ):
        assert dependency in requirements
    assert "requirements-kronos.txt" not in (ROOT / "quant-worker/requirements.txt").read_text()

    assert "quant-worker/.runtime/" in (ROOT / ".gitignore").read_text()


def test_setup_script_rejects_revision_drift() -> None:
    script = (ROOT / "quant-worker/scripts/setup_kronos.ps1").read_text()

    assert "rev-parse HEAD" in script
    assert "Source revision mismatch" in script
    assert "local_dir" in script
    assert "resolved.name != item[\"revision\"]" in script
    assert "sha256-manifest.json" in script
