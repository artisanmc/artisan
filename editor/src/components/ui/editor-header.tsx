import { IconTile } from "@/components/ui/icon-tile";
import { type KindAppearance, kindAppearance } from "@/lib/documentKindAppearance";
import type { ReactNode } from "react";

/**
 * The top of a Document's editor (or any page about one object): the kind's tile and
 * colour, a short eyebrow naming the kind, the title large, then `meta` on the right
 * (chips, actions). `children` runs under the title (a command's arguments…).
 */
export function EditorHeader({
  kind,
  appearance,
  eyebrow,
  title,
  meta,
  children,
}: {
  /** A Document kind (`command`, `menu`, `dialog`, a module kind); or pass `appearance`. */
  kind?: string;
  appearance?: KindAppearance;
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const look = appearance ?? kindAppearance(kind ?? "");
  return (
    <header
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-[var(--border-soft)] border-b px-4 py-3.5"
      style={{ backgroundImage: `linear-gradient(90deg, ${look.soft}, transparent 60%)` }}
    >
      <IconTile icon={look.icon} fg={look.fg} soft={look.soft} line={look.line} size="lg" />
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold tracking-wide" style={{ color: look.fg }}>
          {eyebrow}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="display truncate text-[22px] text-[var(--text)]">{title}</h2>
          {children}
        </div>
      </div>
      {meta ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{meta}</div> : null}
    </header>
  );
}
