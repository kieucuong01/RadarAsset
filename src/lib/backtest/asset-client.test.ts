import { describe, expect, it, vi } from "vitest";

import { assetReadinessLabel, getQuantAssets, parseQuantAssetCatalog } from "./asset-client";
import type { QuantAssetCatalogItem } from "./asset-client";

const validItem = {
  symbol: "VNM",
  name: "Vinamilk",
  market: "vn_equity",
  venue: "HOSE",
  currency: "VND",
  maxLeverage: 2,
  timeframe: "1d",
  datasetVersionId: "11111111-1111-4111-8111-111111111111",
  coverageStart: "2025-01-01T00:00:00.000Z",
  coverageEnd: "2026-01-01T00:00:00.000Z",
  rowCount: 250,
  freshness: "fresh",
  backtestable: true,
  reasonCode: null,
  listingStatus: "active",
  availableAdjustments: ["raw", "total_return"],
  calendarVersion: "hose-official-closures-2024-2026-v1",
  qualityIssueCount: 0,
  blockingQualityIssueCount: 0,
  catalogCoverage: {
    firstObservedAt: "2024-01-01T00:00:00.000Z",
    completeForRequestedRange: true,
    warningCode: null,
  },
} satisfies QuantAssetCatalogItem;

describe("Quant asset catalog client", () => {
  it("encodes the bounded search and validates the complete response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [validItem] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await getQuantAssets(
      { q: "VN M", timeframe: "1d", from: "2025-01-01", to: "2026-01-01" },
      fetcher,
    );

    expect(result.items).toEqual([validItem]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quant/assets?q=VN+M&timeframe=1d&from=2025-01-01&to=2026-01-01",
      { cache: "no-store" },
    );
  });

  it("rejects missing, extra, or internally inconsistent catalog fields", () => {
    expect(() =>
      parseQuantAssetCatalog({ items: [{ ...validItem, internalProviderKey: "x" }] }),
    ).toThrow("Invalid quant asset catalog response.");
    expect(() =>
      parseQuantAssetCatalog({
        items: [{ ...validItem, backtestable: false, reasonCode: null }],
      }),
    ).toThrow("Invalid quant asset catalog response.");
  });

  it("explains range-insufficient assets separately from missing datasets", () => {
    expect(
      assetReadinessLabel({
        ...validItem,
        backtestable: false,
        reasonCode: "DATASET_RANGE_INSUFFICIENT",
        coverageStart: "2024-08-12T00:00:00.000Z",
        coverageEnd: "2026-08-10T00:00:00.000Z",
        rowCount: 497,
      }),
    ).toEqual({
      badge: "Ngoài khoảng dữ liệu",
      detail: "497 bars, 2024-08-12 đến 2026-08-10",
    });

    expect(
      assetReadinessLabel({
        ...validItem,
        backtestable: false,
        reasonCode: "DATASET_UNAVAILABLE",
        datasetVersionId: null,
        coverageStart: null,
        coverageEnd: null,
        rowCount: 0,
      }).badge,
    ).toBe("Chưa có dataset");

    expect(
      assetReadinessLabel(
        {
          ...validItem,
          backtestable: false,
          reasonCode: "DATASET_PROVIDER_GAP",
          qualityIssueCount: 2,
          blockingQualityIssueCount: 1,
        },
        "en",
      ),
    ).toEqual({ badge: "Provider data gap", detail: "1 blocking ranges" });
  });

  it("discloses partial catalog history even when price data is backtestable", () => {
    expect(
      assetReadinessLabel(
        {
          ...validItem,
          catalogCoverage: {
            firstObservedAt: "2025-06-01T00:00:00.000Z",
            completeForRequestedRange: false,
            warningCode: "SURVIVORSHIP_COVERAGE_PARTIAL",
          },
        },
        "en",
      ),
    ).toEqual({
      badge: "Partial history coverage",
      detail: "250 bars · catalog since 2025-06-01",
    });
  });

  it("groups row counts with shared count punctuation", () => {
    expect(assetReadinessLabel({ ...validItem, rowCount: 12_450 })).toEqual({
      badge: "Sẵn sàng",
      detail: "12,450 bars",
    });
  });
});
