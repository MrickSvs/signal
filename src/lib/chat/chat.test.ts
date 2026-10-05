import { describe, expect, it } from "vitest";
import { citedIds, excerptAround, idKind, splitChatIds } from "./ids";
import { createSseParser } from "./sse";
import { pageContext, recommendationPrompt, suggestionsFor } from "./suggestions";
import { formatDuration, loadedSkills } from "./trace";

describe("ids of an answer (CL-28)", () => {
  it("finds every kind of readable id once, in order", () => {
    const text =
      "I-07 (R-042, R-042.1) touche C-013 ; voir US-001, BUG-002, TT-003, E-01, D-004, T-101 et I-07.";
    expect(citedIds(text)).toEqual([
      "I-07",
      "R-042",
      "R-042.1",
      "C-013",
      "US-001",
      "BUG-002",
      "TT-003",
      "E-01",
      "D-004",
      "T-101",
    ]);
  });

  it("does not read a ticket inside TT- nor ids glued to words", () => {
    expect(citedIds("TT-101 et XR-042 et I-7")).toEqual(["TT-101"]);
  });

  it("maps each id to its kind", () => {
    expect(
      ["R-042", "R-042.1", "I-07", "C-013", "D-001", "E-01", "T-101", "US-001"].map(idKind),
    ).toEqual(["feedback", "item", "insight", "customer", "decision", "epic", "ticket", "backlog"]);
  });

  it("splits a text around its ids", () => {
    expect(splitChatIds("Voir I-07.")).toEqual([
      { kind: "text", value: "Voir " },
      { kind: "id", value: "I-07" },
      { kind: "text", value: "." },
    ]);
  });

  it("keeps a bounded excerpt around an id, on one line", () => {
    const text = `${"a ".repeat(200)}R-999 est cité\nici ${"b ".repeat(200)}`;
    const excerpt = excerptAround(text, "R-999", 60);
    expect(excerpt).toContain("R-999 est cité ici");
    expect(excerpt.startsWith("…") && excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(62);
    expect(excerptAround("rien", "R-999")).toBe("");
  });
});

describe("SSE parser", () => {
  it("rebuilds events split across chunks and skips malformed ones", () => {
    const events: [string, unknown][] = [];
    const parse = createSseParser((type, data) => events.push([type, data]));
    parse('event: token\ndata: {"type":"token","te');
    parse('xt":"Bon"}\n\nevent: token\ndata: oops\n\n');
    parse('event: done\r\ndata: {"type":"done"}\r\n\r\n');
    expect(events).toEqual([
      ["token", { type: "token", text: "Bon" }],
      ["done", { type: "done" }],
    ]);
  });
});

describe("page context and suggestions", () => {
  it("reads the entity from the path or the query", () => {
    expect(pageContext("/insights/I-07")).toEqual({ page: "/insights/I-07", entity_id: "I-07" });
    expect(pageContext("/retours", "?retour=R-042&page=2")).toEqual({
      page: "/retours",
      entity_id: "R-042",
    });
    expect(pageContext("/priorisation", "?mode=mrr")).toEqual({
      page: "/priorisation",
      entity_id: null,
    });
    expect(pageContext("/retours", "?retour=<script>")).toEqual({
      page: "/retours",
      entity_id: null,
    });
  });

  it("gives three suggestions on every page, about the insight when one is open", () => {
    for (const page of [
      "/",
      "/retours",
      "/insights",
      "/priorisation",
      "/backlog",
      "/evals",
      "/contexte",
      "/inconnue",
    ])
      expect(suggestionsFor({ page, entity_id: null })).toHaveLength(3);
    expect(suggestionsFor({ page: "/insights/I-07", entity_id: "I-07" })).toEqual([
      "Pourquoi I-07 est-il classé ici ?",
      "Qui est concerné par I-07 ?",
      "Prépare le backlog de I-07.",
    ]);
  });

  it("pre-fills a message from a digest recommendation", () => {
    expect(recommendationPrompt("Traiter I-27", ["R-001", "R-002"])).toBe(
      "Parlons de ta recommandation « Traiter I-27 » (preuves : R-001, R-002). Qu'est-ce qui la justifie, et que dois-je trancher ?",
    );
    expect(recommendationPrompt("Traiter I-27", [])).not.toContain("preuves");
  });
});

describe("trace", () => {
  it("lists the skills loaded in a turn", () => {
    expect(
      loadedSkills([
        { name: "load_skill", args: '{"name":"challenge"}' },
        { name: "get_insight", args: '{"id":"I-07"}' },
        { name: "load_skill", args: '{"name":"challenge"}' },
        { name: "load_skill", args: "{tronqué…" },
      ]),
    ).toEqual(["challenge"]);
  });

  it("adds the skills a drafting tool loads by itself", () => {
    expect(
      loadedSkills([
        { name: "load_skill", args: '{"name":"estimation"}' },
        { name: "draft_backlog_items", args: '{"insight_id":"I-31"}' },
      ]),
    ).toEqual(["estimation", "backlog-format", "user-story"]);
  });

  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_400)).toBe("12,4 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
  });
});
