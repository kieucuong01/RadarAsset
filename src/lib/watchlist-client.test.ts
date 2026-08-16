import { describe, expect, it } from "vitest";

import { loadFavoriteAssets, removeFavoriteAsset, saveWatchlistItem } from "./watchlist-client";

describe("watchlist client", () => {
  it("normalizes the asset payload and returns the refreshed list", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify([
          {
            id: "w1",
            sym: "BTC",
            name: "Bitcoin",
            price: 67_420,
            chg: 2.5,
            alert: 70_000,
            sentiment: "bull",
            datasetState: "ready",
            ingestionRequestId: null,
            backtestableTimeframes: ["1d"],
            currency: "USDT",
            hasMarketQuote: true,
          },
        ]),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };

    const result = await saveWatchlistItem({ symbol: " btc ", alert: 70_000 }, request);

    expect(capturedUrl).toBe("/api/watchlist");
    expect(capturedInit).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "BTC", alert: 70_000 }),
    });
    expect(result).toEqual([
      {
        id: "w1",
        sym: "BTC",
        name: "Bitcoin",
        price: 67_420,
        chg: 2.5,
        alert: 70_000,
        sentiment: "bull",
        datasetState: "ready",
        ingestionRequestId: null,
        backtestableTimeframes: ["1d"],
        currency: "USDT",
        hasMarketQuote: true,
      },
    ]);
  });

  it("loads and strictly validates favorite data state", async () => {
    const request = async () =>
      new Response(
        JSON.stringify([
          {
            id: "w1",
            sym: "ETH",
            name: "Ethereum",
            price: 3500,
            chg: 1,
            alert: 0,
            sentiment: "neutral",
            datasetState: "loading",
            ingestionRequestId: "request-1",
            backtestableTimeframes: [],
          },
        ]),
      );

    await expect(loadFavoriteAssets(request)).resolves.toMatchObject([
      { sym: "ETH", datasetState: "loading", ingestionRequestId: "request-1" },
    ]);
  });

  it("deletes one tracked asset and reports whether opinion refresh was queued", async () => {
    let captured = "";
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = `${String(input)}:${init?.method}`;
      return new Response(null, {
        status: 204,
        headers: { "X-Smart-Insights-Refresh": "queued" },
      });
    };

    await expect(removeFavoriteAsset("favorite-a", request)).resolves.toEqual({
      refreshQueued: true,
    });
    expect(captured).toBe("/api/watchlist/favorite-a:DELETE");

    await expect(
      removeFavoriteAsset(
        "favorite-b",
        async () =>
          new Response(null, {
            status: 204,
            headers: { "X-Smart-Insights-Refresh": "failed" },
          }),
      ),
    ).resolves.toEqual({ refreshQueued: false });
  });

  it("rejects malformed favorite response data", async () => {
    const request = async () => new Response(JSON.stringify([{ id: "w1", sym: "ETH" }]));
    await expect(loadFavoriteAssets(request)).rejects.toThrow("invalid");
  });

  it("surfaces an API error instead of reporting success", async () => {
    const request = async () =>
      new Response(JSON.stringify({ error: "Asset ABC not found." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });

    await expect(saveWatchlistItem({ symbol: "ABC", alert: null }, request)).rejects.toThrow(
      "Asset ABC not found.",
    );
  });
});
