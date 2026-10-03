import { describe, expect, it } from "vitest";
import { isBearerAuthorized } from "./basic-auth";

describe("isBearerAuthorized", () => {
  it("accepts « Bearer <secret> » only, and nothing without a secret", () => {
    expect(isBearerAuthorized("Bearer abc", "abc")).toBe(true);
    expect(isBearerAuthorized("Bearer abd", "abc")).toBe(false);
    expect(isBearerAuthorized("Bearer abcd", "abc")).toBe(false);
    expect(isBearerAuthorized("abc", "abc")).toBe(false);
    expect(isBearerAuthorized(null, "abc")).toBe(false);
    expect(isBearerAuthorized("Bearer ", "")).toBe(false);
    expect(isBearerAuthorized("Bearer x", undefined)).toBe(false);
  });
});
