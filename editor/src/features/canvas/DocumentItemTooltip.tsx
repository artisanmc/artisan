import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useDocumentItemHoverStore } from "@/state/documentItemHoverStore";

/**
 * The tooltip of a module Document's row (`BoardItem.hover`): a DOM overlay following the
 * pointer, like the edges' and the items' tooltips. It never takes a pointer event.
 */
export function DocumentItemTooltip() {
  const hover = useDocumentItemHoverStore((s) => s.hover);
  const x = useDocumentItemHoverStore((s) => s.x);
  const y = useDocumentItemHoverStore((s) => s.y);
  if (!hover || (!hover.title && !hover.text && !hover.lines?.length)) return null;
  return (
    <div
      data-testid="document-item-tooltip"
      style={{ left: x + 14, top: y + 14, boxShadow: "var(--shadow-md)" }}
      className="card pointer-events-none fixed z-[9999] flex max-w-[320px] flex-col gap-1.5 px-3 py-2"
    >
      {hover.title ? (
        <MiniMessageInline
          source={hover.title}
          className="block text-[13px] font-medium text-[var(--text)]"
        />
      ) : null}
      {hover.text ? (
        <MiniMessageInline
          source={hover.text}
          className="block whitespace-pre-wrap text-xs text-[var(--text-mut)]"
        />
      ) : null}
      {hover.lines?.length ? (
        <ul className="flex flex-col gap-0.5 border-[var(--border-soft)] border-t pt-1.5">
          {hover.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
            <li key={i} className="flex gap-1.5 text-xs text-[var(--text)]">
              <span className="text-[var(--text-faint)]">•</span>
              <MiniMessageInline source={line} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
