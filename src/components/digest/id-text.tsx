import { BacklogItemChip, EvidenceChip, InsightChip } from "@/components/signal/chips";
import { parseDigestMarkdown, splitIds } from "@/lib/digest/content";

/** A text whose readable ids become clickable chips (SPEC §12.1). Rendered as text, never HTML. */
export function IdText({ text }: { text: string }) {
  return (
    <>
      {splitIds(text).map((part, index) => {
        if (part.kind === "text") return <span key={index}>{part.value}</span>;
        const id = part.value;
        // An item (R-042.1) opens the preview of its feedback.
        if (id.startsWith("R-")) return <EvidenceChip key={index} id={id.split(".")[0]!} />;
        if (id.startsWith("I-")) return <InsightChip key={index} id={id} />;
        if (/^(?:US|BUG|TT)-/.test(id)) return <BacklogItemChip key={index} id={id} />;
        return (
          <span key={index} className="font-mono text-[13px] font-medium">
            {id}
          </span>
        );
      })}
    </>
  );
}

/** The digest's Markdown subset (headings, items, paragraphs), with clickable ids. */
export function DigestMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="flex flex-col gap-1.5 leading-relaxed">
      {parseDigestMarkdown(markdown).map((block, index) => {
        const text = block.text.replaceAll("**", "");
        if (block.kind === "heading")
          return (
            <p key={index} className="mt-3 font-semibold first:mt-0">
              {text}
            </p>
          );
        if (block.kind === "item")
          return (
            <p key={index} className="flex gap-2 pl-1">
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <span>
                <IdText text={text} />
              </span>
            </p>
          );
        return (
          <p key={index}>
            <IdText text={text} />
          </p>
        );
      })}
    </div>
  );
}
