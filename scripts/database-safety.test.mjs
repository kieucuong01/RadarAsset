import { describe, expect, it } from "vitest";

import { validateIntegrationDatabases } from "./database-safety.mjs";

describe("integration database safety", () => {
  it("accepts the exact local development/test database pair", () => {
    expect(
      validateIntegrationDatabases(
        "postgresql://postgres:secret@localhost:5432/radar",
        "postgresql://postgres:secret@localhost:5432/radar_test?schema=public",
      ),
    ).toEqual(
      expect.objectContaining({
        development: expect.objectContaining({ databaseName: "radar" }),
        test: expect.objectContaining({ databaseName: "radar_test" }),
      }),
    );
  });

  it.each([
    [
      "postgresql://postgres:secret@localhost:5432/radar_test",
      "postgresql://postgres:secret@localhost:5432/radar_test?schema=public",
    ],
    [
      "postgresql://postgres:secret@localhost:5432/radar%5Ftest",
      "postgresql://postgres:secret@localhost:5432/radar_test",
    ],
  ])("rejects URL variants that identify the same database", (development, test) => {
    expect(() => validateIntegrationDatabases(development, test)).toThrow(
      "must not identify the development database",
    );
  });

  it("rejects non-local integration databases", () => {
    expect(() =>
      validateIntegrationDatabases(
        "postgresql://postgres:secret@localhost:5432/radar",
        "postgresql://postgres:secret@db.example.com:5432/radar_test",
      ),
    ).toThrow("local PostgreSQL host");
  });

  it("rejects a test database unrelated to the development database", () => {
    expect(() =>
      validateIntegrationDatabases(
        "postgresql://postgres:secret@localhost:5432/radar",
        "postgresql://postgres:secret@localhost:5432/another_test",
      ),
    ).toThrow("development database name plus _test");
  });
});
