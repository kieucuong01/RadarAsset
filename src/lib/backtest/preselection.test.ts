import { describe, expect, it } from "vitest";

import { normalizePreselectedSymbols } from "./preselection";

describe("Quant Lab URL preselection", () => {
  it("normalizes comma-separated and repeated values without fixed defaults", () => {
    expect(normalizePreselectedSymbols([" btc, VNM ", "xau", "BTC"])).toEqual([
      "BTC",
      "VNM",
      "XAU",
    ]);
  });

  it("drops invalid symbols and caps the handoff at ten assets", () => {
    expect(
      normalizePreselectedSymbols(["A,B,C,D,E,F,G,H,I,J,K", "bad symbol", "<script>"]),
    ).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  });
});
