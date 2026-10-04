import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Context pack files are trusted repo content, but raw HTML stays disabled (react-markdown's
// default): the page renders markdown, never HTML.
const components: Components = {
  h1: ({ children }) => <h2 className="mt-6 text-lg font-semibold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-6 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 font-semibold">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 font-medium">{children}</h5>,
  p: ({ children }) => <p className="mt-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-signal underline-offset-4 hover:underline">
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
    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b px-2 py-1.5 font-medium text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-4" />,
};

export function Markdown({ source }: { source: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
