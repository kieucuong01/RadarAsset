import { describe, expect, it } from "vitest";

import { canonicalJson, implementationHash } from "./hash";

describe("custom strategy hashing", () => {
  it("produces the same canonical JSON and hash regardless of object key order", () => {
    expect(canonicalJson({ b: 2, a: { z: true, y: [3, 1] } })).toBe(
      '{"a":{"y":[3,1],"z":true},"b":2}',
    );
    expect(implementationHash({ b: 2, a: 1 })).toBe(implementationHash({ a: 1, b: 2 }));
  });

  it("changes the hash when the normalized rule changes", () => {
    const rule = {
      schemaVersion: 1,
      kind: "price_threshold" as const,
      operator: "crosses_above" as const,
      threshold: 50_000,
      currency: "USD" as const,
      action: "buy" as const,
      sizePct: 25,
    };
    expect(implementationHash(rule)).toMatch(/^[a-f0-9]{64}$/);
    expect(implementationHash(rule)).not.toBe(implementationHash({ ...rule, sizePct: 50 }));
  });

  it("rejects non-finite values rather than serializing them ambiguously", () => {
    expect(() => canonicalJson({ threshold: Number.NaN })).toThrow();
    expect(() => canonicalJson({ threshold: Number.POSITIVE_INFINITY })).toThrow();
  });
});
