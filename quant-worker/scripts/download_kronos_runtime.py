from __future__ import annotations

import json
import sys
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download


def download(lock_path: Path, model_root: Path) -> None:
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    revisions = model_root / "resolved-revisions"
    revisions.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    for name in ("model", "tokenizer"):
        item = lock[name]
        resolved_revision = api.model_info(item["id"], revision=item["revision"]).sha
        if resolved_revision != item["revision"]:
            raise RuntimeError(
                f"Resolved revision mismatch for {name}: {resolved_revision}"
            )
        resolved = Path(
            snapshot_download(
                repo_id=item["id"],
                revision=item["revision"],
                local_dir=model_root / name,
                local_dir_use_symlinks=False,
            )
        )
        if not resolved.is_dir():
            raise RuntimeError(f"Downloaded directory missing for {name}: {resolved}")
        revision_file = revisions / f"{name}.txt"
        revision_file.write_text(item["revision"], encoding="utf-8")
        if revision_file.read_text(encoding="utf-8").strip() != item["revision"]:
            raise RuntimeError(f"Revision file mismatch for {name}: {resolved}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: download_kronos_runtime.py LOCK_PATH MODEL_ROOT")
    download(Path(sys.argv[1]), Path(sys.argv[2]))
