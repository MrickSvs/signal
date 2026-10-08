import { describe, expect, it } from "vitest";
import { decodeEvents, encodeEvent, type DigestStreamEvent } from "./stream";

const progress: DigestStreamEvent = {
  type: "progress",
  at: 120,
  event: { step: "memory", handled: 2 },
};
const done: DigestStreamEvent = {
  type: "done",
  result: { id: "d1", writer: "modele", costEur: 0.03, durationMs: 14_000 },
};

describe("digest stream", () => {
  it("round-trips events, one per line", () => {
    const { events, rest } = decodeEvents(encodeEvent(progress) + encodeEvent(done));
    expect(events).toEqual([progress, done]);
    expect(rest).toBe("");
  });

  it("keeps an unfinished line for the next chunk", () => {
    const whole = encodeEvent(progress) + encodeEvent(done);
    const cut = whole.length - 10;
    const first = decodeEvents(whole.slice(0, cut));
    expect(first.events).toEqual([progress]);
    const second = decodeEvents(first.rest + whole.slice(cut));
    expect(second.events).toEqual([done]);
  });

  it("skips blank and broken lines", () => {
    const { events } = decodeEvents(`\n{oops\n${encodeEvent(done)}`);
    expect(events).toEqual([done]);
  });
});
