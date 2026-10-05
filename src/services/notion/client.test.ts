import { APIErrorCode, APIResponseError } from "@notionhq/client";
import { describe, expect, it } from "vitest";
import { createLimiter, NotionError, notionConfig, notionErrorMessage } from "./client";

function apiError(code: APIErrorCode, status: number) {
  return new APIResponseError({
    code,
    status,
    message: "message de Notion",
    headers: new Headers(),
    rawBodyText: "{}",
    additional_data: undefined,
    request_id: undefined,
  });
}

describe("rate limiter (CL-41)", () => {
  it("spaces the starts of the calls by the minimum interval", async () => {
    let now = 0;
    const starts: number[] = [];
    const limit = createLimiter(340, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    for (let i = 0; i < 4; i++) await limit(async () => starts.push(now));
    expect(starts).toEqual([0, 340, 680, 1020]);
  });

  it("does not wait when calls are already spaced", async () => {
    let now = 0;
    let slept = 0;
    const limit = createLimiter(340, {
      now: () => now,
      sleep: async (ms) => {
        slept += ms;
      },
    });
    await limit(async () => {});
    now = 1000;
    await limit(async () => {});
    expect(slept).toBe(0);
  });
});

describe("configuration", () => {
  it("reads the environment and refuses a missing token clearly", () => {
    expect(() => notionConfig({})).toThrow(NotionError);
    expect(
      notionConfig({ NOTION_TOKEN: " ntn_x ", NOTION_DS_BACKLOG: "ds", APP_BASE_URL: "" }),
    ).toEqual({
      token: "ntn_x",
      parentPageId: null,
      backlogDataSourceId: "ds",
      appBaseUrl: "http://localhost:3000",
    });
  });
});

describe("error messages (CL-35)", () => {
  it("explains the usual Notion failures in a short sentence", () => {
    expect(notionErrorMessage(apiError(APIErrorCode.Unauthorized, 401))).toMatch(/jeton/);
    expect(notionErrorMessage(apiError(APIErrorCode.ObjectNotFound, 404))).toMatch(
      /NOTION_DS_BACKLOG/,
    );
    expect(notionErrorMessage(apiError(APIErrorCode.RateLimited, 429))).toMatch(/débit/);
    expect(notionErrorMessage(apiError(APIErrorCode.ServiceUnavailable, 503))).toMatch(
      /indisponible/,
    );
    expect(notionErrorMessage(new NotionError("Notion n'est pas configuré"))).toBe(
      "Notion n'est pas configuré",
    );
    expect(notionErrorMessage(new Error("fetch failed"))).toMatch(/fetch failed/);
  });
});
