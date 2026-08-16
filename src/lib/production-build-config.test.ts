import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("production build configuration", () => {
  it("emits a standalone Next.js runtime", () => {
    expect(nextConfig.output).toBe("standalone");
  });
});
