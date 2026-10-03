import { describe, expect, it } from "vitest";
import { languageLabel, modelFamily, notionPageUrl, sentimentLabel } from "./labels";

describe("modelFamily", () => {
  it("maps model ids to their family", () => {
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("Haiku");
    expect(modelFamily("claude-sonnet-5-5")).toBe("Sonnet");
    expect(modelFamily("claude-opus-5-5")).toBe("Opus");
    expect(modelFamily("voyage-4")).toBeNull();
  });
});

describe("notionPageUrl", () => {
  it("strips dashes from the page id", () => {
    expect(notionPageUrl("1a2b3c4d-0000-1111-2222-333344445555")).toBe(
      "https://www.notion.so/1a2b3c4d000011112222333344445555",
    );
  });
});

describe("sentimentLabel and languageLabel", () => {
  it("names the sentiment scale and languages in French", () => {
    expect(sentimentLabel(-2)).toBe("Très négatif");
    expect(sentimentLabel(0)).toBe("Neutre");
    expect(sentimentLabel(1)).toBe("Positif");
    expect(languageLabel("en")).toBe("anglais");
    expect(languageLabel("not a code")).toBe("not a code");
  });
});
