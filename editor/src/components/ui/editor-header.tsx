import { IconTile } from "@/components/ui/icon-tile";
import { type KindAppearance, kindAppearance } from "@/lib/documentKindAppearance";
import type { ReactNode } from "react";

/**
 * The top of a Document's editor (or any page about one object): the kind's tile and
 * colour, a short eyebrow naming the kind, the title large, then `meta` on the right
 * (chips, actions). `children` runs beside the title (a command's arguments…), `details` on
 * its own line under the whole row, full width (a trigger's event sentence and its chips).
 */
export function EditorHeader({
  kind,
  appearance,
  eyebrow,
  title,
  meta,
  details,
  children,
}: {
  /** A Document kind (`command`, `menu`, `dialog`, a module kind); or pass `appearance`. */
  kind?: string;
  appearance?: KindAppearance;
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  children?: ReactNode;
}) {
  const look = appearance ?? kindAppearance(kind ?? "");
  return (
    <header
      className="editor-header-wash flex flex-wrap items-center gap-x-4 gap-y-2 border-[var(--border-soft)] border-b px-4 py-3.5"
      style={{ backgroundImage: `linear-gradient(90deg, ${look.soft}, transparent 60%)` }}
    >
      <span className="flex shrink-0">
        <IconTile icon={look.icon} fg={look.fg} soft={look.soft} line={look.line} size="lg" />
      </span>
      {/* A zero basis: a long title truncates beside the tile instead of wrapping under it. */}
      <div className="min-w-0 flex-1 basis-40">
        <div className="text-[11.5px] font-semibold tracking-wide" style={{ color: look.fg }}>
          {eyebrow}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="display min-w-0 max-w-full truncate text-[22px] text-[var(--text)]">
            {title}
          </h2>
          {children}
        </div>
      </div>
      {meta ? (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{meta}</div>
      ) : null}
      {details ? <div className="min-w-0 basis-full">{details}</div> : null}
    </header>
  );
}
