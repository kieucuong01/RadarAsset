import { afterEach, describe, expect, it, vi } from "vitest";

import { requireBetterAuthSecret, requireServerEnv } from "./env";

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

    expect(() => requireServerEnv("AUTH_TEST_VALUE")).toThrow("AUTH_TEST_VALUE is required.");
  });
});

describe("requireBetterAuthSecret", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
    vi.unstubAllEnvs();
  });

  it("rejects secrets shorter than 32 characters outside tests", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.BETTER_AUTH_SECRET = "too-short";

    expect(() => requireBetterAuthSecret()).toThrow(
      "BETTER_AUTH_SECRET must contain at least 32 characters.",
    );
  });

  it("allows a fixed short secret only in tests", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.BETTER_AUTH_SECRET = "test-only";

    expect(requireBetterAuthSecret()).toBe("test-only");
  });
});
