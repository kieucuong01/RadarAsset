from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_kronos_imports_are_isolated_from_decision_modules() -> None:
    forbidden_tokens = (
        "briefing",
        "personalization",
        "portfolio",
        "signal",
        "regime",
        "alert",
        "recommendation",
        "action",
    )
    offenders: list[str] = []

    for path in (ROOT / "quant-worker").rglob("*.py"):
        relative = path.relative_to(ROOT).as_posix().lower()
        if "/kronos/" in relative or relative.endswith("run_kronos_shadow.py") or "/tests/" in relative:
            continue
        if any(token in relative for token in forbidden_tokens) and "smart_insights.kronos" in path.read_text(encoding="utf-8"):
            offenders.append(relative)

    for path in (ROOT / "src").rglob("*.ts*"):
        relative = path.relative_to(ROOT).as_posix().lower()
        if any(token in relative for token in forbidden_tokens) and "smart-insights-forecast" in path.read_text(encoding="utf-8"):
            offenders.append(relative)

    assert offenders == []
