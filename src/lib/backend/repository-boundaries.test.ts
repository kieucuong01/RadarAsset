import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MARKET_ROUTES = [
  "src/app/api/assets/route.ts",
  "src/app/api/market/ticker/route.ts",
  "src/app/api/market/bars/route.ts",
  "src/app/api/market/data-health/route.ts",
];

const PORTFOLIO_ROUTES = [
  "src/app/api/portfolio/route.ts",
  "src/app/api/portfolio/performance/route.ts",
  "src/app/api/portfolio/transactions/route.ts",
];

const RESEARCH_ROUTES = [
  "src/app/api/insights/route.ts",
  "src/app/api/events/route.ts",
  "src/app/api/assets/[symbol]/intelligence/route.ts",
  "src/app/api/watchlist/route.ts",
  "src/app/api/watchlist/[id]/route.ts",
  "src/app/api/research/runs/route.ts",
  "src/app/api/research/runs/import/route.ts",
];

describe("backend repository boundaries", () => {
  it("routes market reads through the market repository", () => {
    for (const route of MARKET_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).not.toContain('from "@/lib/backend/db"');
    }
  });

  it("routes portfolio operations through the portfolio repository", () => {
    for (const route of PORTFOLIO_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).not.toContain('from "@/lib/backend/db"');
    }
  });

  it("routes research and watchlist operations through the research repository", () => {
    for (const route of RESEARCH_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).not.toContain('from "@/lib/backend/db"');
    }
  });
});
