import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MARKET_ROUTES = [
  "src/app/api/assets/route.ts",
  "src/app/api/market/ticker/route.ts",
  "src/app/api/market/bars/route.ts",
  "src/app/api/market/data-health/route.ts",
];

describe("backend repository boundaries", () => {
  it("routes market reads through the market repository", () => {
    for (const route of MARKET_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).not.toContain('from "@/lib/backend/db"');
    }
  });
});
