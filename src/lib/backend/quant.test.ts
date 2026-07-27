import { describe, expect, it } from "vitest";

import { canTransitionQuantRun } from "./quant";

describe("quant backend domain", () => {
  it("allows queued runs to start and running runs to finish", () => {
    expect(canTransitionQuantRun("queued", "running")).toBe(true);
    expect(canTransitionQuantRun("running", "succeeded")).toBe(true);
    expect(canTransitionQuantRun("running", "failed")).toBe(true);
  });

  it("rejects terminal runs moving back to active states", () => {
    expect(canTransitionQuantRun("succeeded", "running")).toBe(false);
    expect(canTransitionQuantRun("failed", "queued")).toBe(false);
  });
});
