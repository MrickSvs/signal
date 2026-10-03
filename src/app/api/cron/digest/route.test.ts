import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The route must refuse before touching the base: any database access fails this test.
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("la base ne doit pas être lue");
  },
}));
const { GET } = await import("./route");

const call = (authorization?: string) =>
  GET(
    new NextRequest("http://localhost:3000/api/cron/digest", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/digest", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("refuses a call without the secret, with a wrong one, or when no secret is configured", async () => {
    expect((await call()).status).toBe(401);
    process.env.CRON_SECRET = "s3cret-de-test";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer mauvais")).status).toBe(401);
    expect((await call("Basic czNjcmV0LWRlLXRlc3Q=")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
  });
});
