from __future__ import annotations

import base64
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import json
from typing import Any

from smart_insights.coinshares_ocr import (
    CoinSharesTable,
    OcrEngine,
    OcrToken,
    RapidOcrEngine,
    discover_coinshares_images,
    published_at_from_html,
    reconstruct_coinshares_table,
)
from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.sources import is_source_url_allowed, source_for_code

from . import CollectionBatch


_IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
_RECONCILIATION_TOLERANCE = Decimal("100000")


def _token_payload(token: OcrToken) -> dict[str, object]:
    return {
        "box": list(token.box),
        "confidence": format(token.confidence, "f"),
        "text": token.text,
    }


class CoinSharesCollector:
    def __init__(
        self,
        *,
        crawler: Any,
        report_url: str,
        ocr_engine: OcrEngine | None = None,
    ) -> None:
        self.source = source_for_code("coinshares-weekly")
        if not is_source_url_allowed(self.source, report_url):
            raise ValueError("Report URL is not allow-listed.")
        self._crawler = crawler
        self._report_url = report_url
        self._ocr = ocr_engine or RapidOcrEngine()

    def collect(self, as_of: datetime) -> CollectionBatch:
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        article_snapshot = self._crawler.scrape(self.source, self._report_url)
        try:
            payload = json.loads(article_snapshot.content)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return CollectionBatch(self.source, article_snapshot, (), "INVALID_RESPONSE")
        html = payload.get("rawHtml") if isinstance(payload, dict) else None
        if not isinstance(html, str) or not html.strip():
            return CollectionBatch(self.source, article_snapshot, (), "SCHEMA_DRIFT")

        try:
            published_at = published_at_from_html(html)
            image_urls = discover_coinshares_images(html, self._report_url)
            assets = {
                kind: self._crawler.download(
                    self.source, url, content_types=_IMAGE_TYPES
                )
                for kind, url in image_urls.items()
            }
            token_sets = {
                kind: self._ocr.recognize(asset.content)
                for kind, asset in assets.items()
            }
            tables = {
                kind: reconstruct_coinshares_table(
                    token_sets[kind],
                    dimension="asset" if kind == "asset" else "region",
                )
                for kind in ("asset", "region")
            }
            self._reconcile(tables["asset"], tables["region"])
        except ValueError as error:
            return CollectionBatch(self.source, article_snapshot, (), str(error))

        effective_at = tables["asset"].effective_at
        if effective_at > published_at or published_at > as_of:
            return CollectionBatch(
                self.source, article_snapshot, (), "INVALID_TIMESTAMP"
            )
        snapshot = self._composite_snapshot(
            article_snapshot=article_snapshot,
            html=html,
            published_at=published_at,
            tables=tables,
            assets=assets,
            token_sets=token_sets,
        )
        observations = self._observations(
            tables["asset"], published_at=published_at
        ) + self._observations(tables["region"], published_at=published_at)
        return CollectionBatch(self.source, snapshot, tuple(observations))

    @staticmethod
    def _reconcile(asset: CoinSharesTable, region: CoinSharesTable) -> None:
        if asset.effective_at != region.effective_at:
            raise ValueError("RECONCILIATION_FAILED")
        if (
            abs(asset.global_flow_usd - region.global_flow_usd)
            > _RECONCILIATION_TOLERANCE
        ):
            raise ValueError("RECONCILIATION_FAILED")
        if (
            asset.global_aum_usd is not None
            and region.global_aum_usd is not None
            and abs(asset.global_aum_usd - region.global_aum_usd)
            > _RECONCILIATION_TOLERANCE
        ):
            raise ValueError("RECONCILIATION_FAILED")

    def _composite_snapshot(
        self,
        *,
        article_snapshot: RawSnapshot,
        html: str,
        published_at: datetime,
        tables: dict[str, CoinSharesTable],
        assets: dict[str, Any],
        token_sets: dict[str, tuple[OcrToken, ...]],
    ) -> RawSnapshot:
        images = []
        for kind in ("asset", "region"):
            asset = assets[kind]
            images.append(
                {
                    "contentBase64": base64.b64encode(asset.content).decode("ascii"),
                    "contentType": asset.content_type,
                    "kind": kind,
                    "ocrTokens": [
                        _token_payload(token) for token in token_sets[kind]
                    ],
                    "sha256": hashlib.sha256(asset.content).hexdigest(),
                    "url": asset.source_url,
                }
            )
        content = json.dumps(
            {
                "articleHtml": html,
                "images": images,
                "ocrEngine": self._ocr.version,
                "tables": {
                    kind: [
                        {
                            "aumUsd": format(row.aum_usd, "f"),
                            "label": row.label,
                            "weekFlowUsd": format(row.week_flow_usd, "f"),
                        }
                        for row in table.rows
                    ]
                    for kind, table in tables.items()
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return RawSnapshot(
            content=content,
            content_type="application/json",
            source_url=self._report_url,
            effective_at=tables["asset"].effective_at,
            published_at=published_at,
            observed_at=article_snapshot.observed_at,
            metadata={
                "collector": "scrapling+rapidocr",
                "ocr_engine": self._ocr.version,
                "parser_version": self.source.parser_version,
            },
        )

    @staticmethod
    def _observations(
        table: CoinSharesTable, *, published_at: datetime
    ) -> list[ObservationInput]:
        observations: list[ObservationInput] = []
        period_start = table.effective_at - timedelta(days=6)
        for row in table.rows:
            common_dimensions = {
                table.dimension: row.label,
                "source_unit": "US$m",
            }
            for metric_code, value in (
                ("crypto.coinshares.net_flow_usd", row.week_flow_usd),
                ("crypto.coinshares.aum_usd", row.aum_usd),
            ):
                observations.append(
                    ObservationInput(
                        metric_code=metric_code,
                        value=value,
                        effective_at=table.effective_at,
                        effective_start=period_start,
                        effective_end=table.effective_at,
                        published_at=published_at,
                        dimensions=common_dimensions,
                    )
                )
        return observations
