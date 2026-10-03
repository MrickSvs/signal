import { describe, expect, it } from "vitest";
import { BUSY_MESSAGE, FAILED_MESSAGE, ingestErrorMessage } from "./ingest";

describe("ingestErrorMessage", () => {
  it("says a run is in progress on 409, whatever the body", () => {
    expect(ingestErrorMessage(409, { error: "verrou" })).toBe(BUSY_MESSAGE);
  });

  it("shows the route's message, or a generic one (CL-11)", () => {
    expect(ingestErrorMessage(400, { error: "raw_text: trop court" })).toBe("raw_text: trop court");
    expect(ingestErrorMessage(500, null)).toBe(FAILED_MESSAGE);
    expect(ingestErrorMessage(502, "<html>")).toBe(FAILED_MESSAGE);
  });
});
