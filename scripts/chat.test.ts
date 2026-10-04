import { describe, expect, it } from "vitest";
import { parseChatArgs } from "./chat";

describe("parseChatArgs", () => {
  const id = () => "new-id";

  it("starts a new conversation by default", () => {
    expect(parseChatArgs([], id)).toEqual({ threadId: "new-id", page: null, message: null });
  });

  it("resumes a thread, sets the page context and takes a single message", () => {
    expect(
      parseChatArgs(
        [
          "--thread",
          "6f1c2b9e-3c1a-4d8e-9f00-1a2b3c4d5e6f",
          "--page",
          "/insights",
          "--entity",
          "I-07",
          "-m",
          "Pourquoi ?",
        ],
        id,
      ),
    ).toEqual({
      threadId: "6f1c2b9e-3c1a-4d8e-9f00-1a2b3c4d5e6f",
      page: { page: "/insights", entity_id: "I-07" },
      message: "Pourquoi ?",
    });
  });

  it("refuses unknown options, a bad thread id or an entity without page", () => {
    expect(() => parseChatArgs(["--verbose"], id)).toThrow(/Option inconnue/);
    expect(() => parseChatArgs(["--thread", "abc"], id)).toThrow(/UUID/);
    expect(() => parseChatArgs(["--entity", "I-07"], id)).toThrow(/--page/);
  });
});
