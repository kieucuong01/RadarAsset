import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [
    {
      id: "missing-values",
      sym: "BTC",
      name: "Missing values",
      price: 0,
      chg: 0,
      alert: 0,
      sentiment: "neutral" as const,
      datasetState: "unavailable" as const,
      ingestionRequestId: null,
      backtestableTimeframes: [] as Array<"1d" | "1h">,
    },
    {
      id: "negative-sentinels",
      sym: "ETH",
      name: "Negative sentinels",
      price: -1,
      chg: 0,
      alert: -10,
      sentiment: "neutral" as const,
      datasetState: "unavailable" as const,
      ingestionRequestId: null,
      backtestableTimeframes: [] as Array<"1d" | "1h">,
    },
  ],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const resolved = typeof initial === "function" ? (initial as () => T)() : initial;
      if (
        Array.isArray(resolved) &&
        resolved.length > 0 &&
        typeof resolved[0] === "object" &&
        resolved[0] !== null &&
        "sym" in resolved[0]
      ) {
        return actual.useState(mocks.rows as T);
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({
    locale: "vi" as const,
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/DataStatusBadge", () => ({
  DataStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/WatchlistAddDialog", () => ({
  WatchlistAddDialog: () => null,
}));

import { LegacyWatchlist } from "./LegacyWatchlist";

function textContent(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

describe("LegacyWatchlist number formatting", () => {
  it("renders non-positive price and alert sentinels as missing", () => {
    const text = textContent(renderToStaticMarkup(<LegacyWatchlist />));

    expect(text).toContain("Missing values—0%—");
    expect(text).toContain("Negative sentinels—0%—");
    expect(text).not.toContain("0 VND");
    expect(text).not.toContain("−1 VND");
    expect(text).not.toContain("−10 VND");
  });
});
