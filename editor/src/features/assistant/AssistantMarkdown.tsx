import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words leading-relaxed [&>*+*]:mt-3 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li+li]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-soft)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-mut)] [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--surface-hover)] [&_code]:px-1 [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[var(--surface-hover)] [&_pre]:p-3 [&_pre_code]:p-0 [&_th]:border [&_th]:border-[var(--border-soft)] [&_th]:px-3 [&_th]:py-1 [&_td]:border [&_td]:border-[var(--border-soft)] [&_td]:px-3 [&_td]:py-1 [&_hr]:border-[var(--border-soft)]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="border-collapse text-left">{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
