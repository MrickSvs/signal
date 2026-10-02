import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const call = (authorization?: string) =>
  proxy(
    new NextRequest("http://localhost:3000/", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("proxy basic auth", () => {
  afterEach(() => {
    delete process.env.SITE_PASSWORD;
  });

  it("lets everything through when SITE_PASSWORD is empty", () => {
    process.env.SITE_PASSWORD = "";
    expect(call().status).toBe(200);
  });

  it("asks for credentials when SITE_PASSWORD is set", () => {
    process.env.SITE_PASSWORD = "secret";
    const res = call();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects a wrong password and accepts the right one", () => {
    process.env.SITE_PASSWORD = "secret";
    expect(call(basic("lea", "nope")).status).toBe(401);
    expect(call(basic("lea", "secret")).status).toBe(200);
  });

  it("rejects a malformed header", () => {
    process.env.SITE_PASSWORD = "secret";
    expect(call("Basic !!!").status).toBe(401);
    expect(call("Bearer secret").status).toBe(401);
  });
});
