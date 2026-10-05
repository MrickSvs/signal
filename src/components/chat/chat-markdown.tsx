"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BacklogItemChip, EvidenceChip, InsightChip } from "@/components/signal/chips";
import { idKind, splitChatIds } from "@/lib/chat/ids";
import { cn } from "@/lib/utils";

// Agent answers in the chat (SPEC §10.7, CL-28, CL-34): markdown without raw HTML (react-markdown
// ignores it by default, images are dropped, unsafe link protocols are stripped by its
// urlTransform), and every readable id becomes a chip once checked against the database.

/** Status of each id of an answer: unchecked while streaming, then known or unknown. */
export type IdStatuses = Record<string, "known" | "unknown"> | null;

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const NO_CHIPS = new Set(["code", "pre", "a"]);

/** Rehype plugin: splits text nodes around readable ids into <span data-chat-id>. */
function rehypeChatIds() {
  const walk = (node: HastNode) => {
    if (!node.children || (node.tagName && NO_CHIPS.has(node.tagName))) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== "text" || !child.value) {
        walk(child);
        return [child];
      }
      return splitChatIds(child.value).map((part) =>
        part.kind === "text"
          ? { type: "text", value: part.value }
          : {
              type: "element",
              tagName: "span",
              properties: { dataChatId: part.value },
              children: [{ type: "text", value: part.value }],
            },
      );
    });
  };
  return (tree: HastNode) => walk(tree);
}

const pill =
  "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 align-baseline font-mono text-[13px] leading-none font-medium whitespace-nowrap";

const STATIC_TITLES: Record<string, string> = {
  customer: "Compte client",
  decision: "Décision du journal",
  epic: "Epic du backlog",
  ticket: "Ticket de référence (estimation)",
};

export function ChatIdChip({ id, status }: { id: string; status: "known" | "unknown" | null }) {
  if (status === "unknown") {
    return (
      <span
        role="note"
        title="Cet ID n'existe pas en base : Signal l'a cité sans preuve. L'incident est journalisé."
        className={cn(pill, "border-destructive/40 bg-destructive/10 text-destructive")}
      >
        {id}
        <span className="font-sans">· ID inconnu</span>
      </span>
    );
  }
  if (status === null) {
    // Not checked yet (streaming): never clickable before the check.
    return <span className={cn(pill, "border-dashed text-muted-foreground")}>{id}</span>;
  }
  const kind = idKind(id);
  if (kind === "feedback" || kind === "item") return <EvidenceChip id={id.split(".")[0]!} />;
  if (kind === "insight") return <InsightChip id={id} />;
  if (kind === "backlog") return <BacklogItemChip id={id} />;
  return (
    <span title={STATIC_TITLES[kind]} className={cn(pill, "bg-background")}>
      {id}
    </span>
  );
}

function components(statuses: IdStatuses): Components {
  return {
    span: (props) => {
      const { node, ...rest } = props;
      const id = (rest as Record<string, unknown>)["data-chat-id"];
      if (typeof id !== "string") return <span {...rest} />;
      void node;
      return <ChatIdChip id={id} status={statuses ? (statuses[id] ?? "unknown") : null} />;
    },
    h1: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
    h2: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
    h3: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
    h4: ({ children }) => <p className="mt-2 font-medium first:mt-0">{children}</p>,
    p: ({ children }) => <p className="mt-2 leading-relaxed first:mt-0">{children}</p>,
    ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="mt-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-signal underline-offset-4 hover:underline"
      >
        {children}
      </a>
    ),
    code: ({ children, className }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{children}</code>
      ),
    pre: ({ children }) => (
      <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[13px]">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b px-1.5 py-1 font-medium text-muted-foreground">{children}</th>
    ),
    td: ({ children }) => <td className="border-b px-1.5 py-1 align-top">{children}</td>,
    hr: () => <hr className="my-3" />,
  };
}

export function ChatMarkdown({ text, statuses }: { text: string; statuses: IdStatuses }) {
  return (
    <div className="text-sm break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeChatIds]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={components(statuses)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
