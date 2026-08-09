import { afterEach, describe, expect, it } from "vitest";

import { requireServerEnv } from "./env";

describe("requireServerEnv", () => {
  const originalValue = process.env.AUTH_TEST_VALUE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.AUTH_TEST_VALUE;
    } else {
      process.env.AUTH_TEST_VALUE = originalValue;
    }
  });

  it("returns a trimmed configured value", () => {
    process.env.AUTH_TEST_VALUE = "  configured  ";

    expect(requireServerEnv("AUTH_TEST_VALUE")).toBe("configured");
  });

  it("rejects missing and whitespace-only values", () => {
    process.env.AUTH_TEST_VALUE = "  ";

    expect(() => requireServerEnv("AUTH_TEST_VALUE")).toThrow(
      "AUTH_TEST_VALUE is required.",
    );
  });
});
