import { cn } from "@/lib/cx";
import type { ComponentType } from "react";

/**
 * A small square carrying an icon in a semantic colour: the step chain's action
 * families, a Document kind in the sidebar or an editor header. `fg` / `soft` are CSS
 * colours, usually `var(--token)` references (`familyColors()`, `kindAppearance()`).
 */
export function IconTile({
  icon: Icon,
  fg,
  soft,
  line,
  size = "sm",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  fg: string;
  soft: string;
  /** A border colour, for a tile that needs to stand out (an editor header). */
  line?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const box = {
    xs: "h-5 w-5 rounded-[5px]",
    sm: "h-6 w-6 rounded-[6px]",
    md: "h-8 w-8 rounded-[8px]",
    lg: "h-11 w-11 rounded-[10px]",
  }[size];
  const glyph = { xs: "size-3", sm: "size-3.5", md: "size-4", lg: "size-[22px]" }[size];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", box, className)}
      style={{ color: fg, background: soft, border: line ? `1px solid ${line}` : undefined }}
    >
      <Icon className={glyph} />
    </span>
  );
}
