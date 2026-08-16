import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  getPrisma: () => ({ $queryRaw: queryRaw }),
}));

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    process.env.DATAVEST_RELEASE_SHA = "abc123";
  });

  afterEach(() => {
    delete process.env.DATAVEST_RELEASE_SHA;
  });

  it("reports readiness after the database probe succeeds", async () => {
    queryRaw.mockResolvedValueOnce([{ one: 1 }]);
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "datavest-web",
      release: "abc123",
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("returns a sanitized 503 when the database probe fails", async () => {
    queryRaw.mockRejectedValueOnce(new Error("postgresql://user:secret@localhost/datavest"));
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain("secret");
    expect(JSON.parse(body)).toEqual({
      status: "unavailable",
      service: "datavest-web",
      release: "abc123",
    });
  });
});
