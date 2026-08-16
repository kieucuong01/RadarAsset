import { afterEach, describe, expect, it } from "vitest";

describe("GET /api/health/live", () => {
  afterEach(() => {
    delete process.env.DATAVEST_RELEASE_SHA;
  });

  it("reports process liveness without exposing configuration", async () => {
    process.env.DATAVEST_RELEASE_SHA = "abc123";
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "datavest-web",
      release: "abc123",
    });
  });

  it("uses an explicit unknown release when no SHA is configured", async () => {
    const { GET } = await import("./route");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ release: "unknown" });
  });
});
