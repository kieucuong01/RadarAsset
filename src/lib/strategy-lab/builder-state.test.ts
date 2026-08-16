import { describe, expect, it } from "vitest";

import {
  applySavedRuleToStrategyBuilder,
  createInitialStrategyBuilderState,
} from "./builder-state";

describe("strategy builder state", () => {
  it("uses the UI locale only when initializing a new draft currency", () => {
    const vietnamese = createInitialStrategyBuilderState("Chiến lược mới", "vi");
    const english = createInitialStrategyBuilderState("New strategy", "en");

    expect(vietnamese.currency).toBe("VND");
    expect(english.currency).toBe("USD");

    const editedVietnamese = { ...vietnamese, currency: "VND" as const };
    createInitialStrategyBuilderState("New strategy", "en");
    expect(editedVietnamese.currency).toBe("VND");
  });

  it("preserves the explicit currency when loading a saved rule", () => {
    const current = createInitialStrategyBuilderState("New strategy", "en");
    const loaded = applySavedRuleToStrategyBuilder(current, {
      name: "VN DCA",
      symbol: "VNM",
      rule: {
        schemaVersion: 1,
        kind: "scheduled_dca",
        contributionAmount: 1_250_000,
        currency: "VND",
        frequency: "monthly",
        dayOfMonth: 5,
      },
    });

    expect(loaded.currency).toBe("VND");
    expect(loaded.amount).toBe(1_250_000);
  });
});
