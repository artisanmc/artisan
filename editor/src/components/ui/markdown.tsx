import { cx } from "@/lib/cx";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { TD, TH, TR, Table } from "./table";

/**
 * Markdown written by a model or a person, rendered with the editor's type and tokens: paragraphs,
 * lists, inline and block code, links, GFM tables. Raw HTML in the text is shown as text, never
 * rendered.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-2 text-[13.5px] leading-relaxed text-[var(--text)]",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  p: ({ node: _, ...p }) => <p className="break-words" {...p} />,
  h1: ({ node: _, ...p }) => <h3 className="text-[15px] font-semibold" {...p} />,
  h2: ({ node: _, ...p }) => <h3 className="text-[14px] font-semibold" {...p} />,
  h3: ({ node: _, ...p }) => <h4 className="text-[13.5px] font-semibold" {...p} />,
  h4: ({ node: _, ...p }) => <h4 className="text-[13.5px] font-semibold" {...p} />,
  ul: ({ node: _, ...p }) => <ul className="flex list-disc flex-col gap-1 pl-5" {...p} />,
  ol: ({ node: _, ...p }) => <ol className="flex list-decimal flex-col gap-1 pl-5" {...p} />,
  a: ({ node: _, ...p }) => (
    <a
      className="text-[var(--brand)] underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  blockquote: ({ node: _, ...p }) => (
    <blockquote className="border-l-2 border-[var(--border)] pl-3 text-[var(--text-mut)]" {...p} />
  ),
  hr: () => <hr className="border-[var(--border-soft)]" />,
  pre: ({ node: _, ...p }) => (
    <pre
      className="overflow-x-auto rounded-[var(--r-md)] bg-[var(--surface)] p-3 font-mono text-[12px] leading-normal [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  code: ({ node: _, className, ...p }) => (
    <code
      className={cx(
        "rounded-[4px] bg-[var(--surface)] px-1 py-px font-mono text-[12.5px]",
        className,
      )}
      {...p}
    />
  ),
  table: ({ node: _, ...p }) => <Table {...p} />,
  tr: ({ node: _, ...p }) => <TR {...p} />,
  th: ({ node: _, style: __, align, ...p }) => (
    <TH align={align === "right" ? "right" : "left"} {...p} />
  ),
  td: ({ node: _, style: __, align, ...p }) => (
    <TD align={align === "right" ? "right" : "left"} {...p} />
  ),
};
