import { describe, expect, it } from "vitest";

import { numberFromDecimal, objectJson, stringArrayJson } from "./db-mappers";

describe("database mappers", () => {
  it("normalizes decimal-like storage values", () => {
    expect(numberFromDecimal(12.5)).toBe(12.5);
    expect(numberFromDecimal("12.5")).toBe(12.5);
    expect(numberFromDecimal({ toString: () => "12.5" })).toBe(12.5);
    expect(numberFromDecimal(null)).toBe(0);
  });

  it("accepts only JSON records", () => {
    expect(objectJson({ nested: true })).toEqual({ nested: true });
    expect(objectJson([])).toEqual({});
    expect(objectJson(null)).toEqual({});
  });

  it("keeps only string array entries", () => {
    expect(stringArrayJson(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(stringArrayJson({ value: "a" })).toEqual([]);
  });
});
