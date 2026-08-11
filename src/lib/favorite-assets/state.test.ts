import { describe, expect, it } from "vitest";

import type { WatchlistItemResponse } from "@/lib/backend/types";

import { favoriteActionState, favoriteReducer, initialFavoriteState } from "./state";

const ready: WatchlistItemResponse = {
  id: "favorite-vnm",
  sym: "VNM",
  name: "Vinamilk",
  price: 70_000,
  chg: 1,
  alert: 0,
  sentiment: "neutral",
  datasetState: "ready",
  ingestionRequestId: null,
  backtestableTimeframes: ["1d"],
};

describe("favorite asset UI state", () => {
  it("enables a safe Quant Lab handoff only for ready favorites", () => {
    expect(favoriteActionState(ready)).toEqual({
      canBacktest: true,
      backtestHref: "/quant-lab?symbols=VNM",
      label: "Ready",
    });
    expect(
      favoriteActionState({
        ...ready,
        sym: "ETH",
        datasetState: "loading",
        ingestionRequestId: "request-1",
        backtestableTimeframes: [],
      }),
    ).toEqual({ canBacktest: false, backtestHref: null, label: "Loading data" });
  });

  it("requires explicit remove confirmation and keeps portfolio accounting outside state", () => {
    const requested = favoriteReducer(initialFavoriteState, {
      type: "removeRequested",
      favoriteId: "favorite-vnm",
    });
    expect(requested.removeCandidateId).toBe("favorite-vnm");
    expect(favoriteReducer(requested, { type: "removeCancelled" })).toEqual(initialFavoriteState);
    expect(Object.keys(requested)).not.toContain("holdings");
  });

  it("labels stale and unavailable data without a fake backtest link", () => {
    expect(
      favoriteActionState({ ...ready, datasetState: "stale", backtestableTimeframes: [] }),
    ).toEqual({ canBacktest: false, backtestHref: null, label: "Stale" });
    expect(
      favoriteActionState({ ...ready, datasetState: "unavailable", backtestableTimeframes: [] }),
    ).toEqual({ canBacktest: false, backtestHref: null, label: "Unavailable" });
  });
});
