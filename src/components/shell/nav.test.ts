import { describe, expect, it } from "vitest";
import { NAV_ITEMS, activeNavItem } from "./nav";

describe("navigation", () => {
  it("has the seven sections of SPEC §12.1 in order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Digest",
      "Retours",
      "Insights",
      "Priorisation",
      "Backlog",
      "Évals",
      "Contexte",
    ]);
  });

  it("matches nested routes to their section", () => {
    expect(activeNavItem("/").label).toBe("Digest");
    expect(activeNavItem("/insights/I-07").label).toBe("Insights");
    expect(activeNavItem("/priorisation").label).toBe("Priorisation");
    expect(activeNavItem("/insightsx").label).toBe("Digest");
  });
});
