import { describe, expect, it } from "vitest";

import { prismaPgConfig } from "./prisma";

describe("Prisma PostgreSQL configuration", () => {
  it("forces UTC so timestamptz deadlines and checksums are stable", () => {
    expect(prismaPgConfig("postgresql://localhost/test")).toEqual({
      connectionString: "postgresql://localhost/test",
      options: "-c timezone=UTC",
    });
  });
});
