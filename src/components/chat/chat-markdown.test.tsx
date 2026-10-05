import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "./chat-markdown";

// The chips load their previews through server functions: never called while rendering.
vi.mock("@/server/actions/evidence", () => ({
  loadFeedbackEvidence: vi.fn(),
  loadInsightPreview: vi.fn(),
  loadBacklogItemPreview: vi.fn(),
}));

const render = (text: string, statuses: Parameters<typeof ChatMarkdown>[0]["statuses"]) =>
  renderToStaticMarkup(<ChatMarkdown text={text} statuses={statuses} />);

describe("ChatMarkdown (CL-28, CL-34)", () => {
  it("never renders raw HTML, scripts or images from an answer", () => {
    const html = render(
      [
        "**Faits** : voici <script>alert('x')</script> et <img src=x onerror=alert(1)>.",
        "",
        '<div onclick="steal()">clic</div>',
        "",
        "![pixel](https://tracker.example/p.gif) [lien](javascript:alert(1))",
      ].join("\n"),
      {},
    );
    expect(html).toContain("<strong>Faits</strong>");
    // Raw HTML stays visible as escaped text, never as elements.
    expect(html).not.toMatch(/<script|<img|<div onclick|href="javascript:/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("tracker.example");
  });

  it("shows an id that does not exist as « ID inconnu », and a known one as a chip", () => {
    const html = render("Le sujet I-07 vient de R-042, mais R-999 n'existe pas.", {
      "I-07": "known",
      "R-042": "known",
      "R-999": "unknown",
    });
    expect(html).toMatch(/R-999<span[^>]*>· ID inconnu<\/span>/);
    expect(html.match(/ID inconnu/g)).toHaveLength(1);
    // Known ids open a preview: a popover trigger (button), not an alert.
    expect(html).toMatch(/<button[^>]*>I-07<\/button>/);
    expect(html).toMatch(/<button[^>]*>R-042<\/button>/);
  });

  it("keeps ids unclickable until they are checked", () => {
    const html = render("Voir I-07.", null);
    expect(html).not.toContain("<button");
    expect(html).toContain("I-07");
    expect(html).not.toContain("ID inconnu");
  });

  it("leaves ids inside code untouched", () => {
    const html = render("`R-999` est un exemple de format.", { "R-999": "unknown" });
    expect(html).not.toContain("ID inconnu");
    expect(html).toContain("<code");
  });
});
