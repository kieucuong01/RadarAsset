import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("TickerTape", () => {
  const source = readFileSync(join(process.cwd(), "src", "components", "TickerTape.tsx"), "utf8");

  it("uses the curated endpoint and slow transform-only marquee", () => {
    expect(source).toContain("curatedTickerUrl()");
    expect(source).toContain("resolveCuratedTickerSnapshot");
    expect(source).toContain("animation: ticker-scroll 160s linear infinite");
    expect(source).toContain("min-w-0 flex-1 overflow-hidden");
    expect(source).toContain("animation-play-state: paused");
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).not.toContain("ticker-scroll 60s");
  });
});
