import { cn } from "@/lib/cx";
import type { LucideIcon } from "lucide-react";

/**
 * A small square carrying an icon in a semantic colour: the step chain's action
 * families, a document kind in an editor header. `fg` / `soft` are `var(--token)`
 * references (e.g. `familyColors()` in lib/actions/actionFamily.ts).
 */
export function IconTile({
  icon: Icon,
  fg,
  soft,
  size = "sm",
  className,
}: {
  icon: LucideIcon;
  fg: string;
  soft: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box =
    size === "lg"
      ? "h-11 w-11 rounded-[10px]"
      : size === "md"
        ? "h-8 w-8 rounded-[8px]"
        : "h-6 w-6 rounded-[6px]";
  const glyph = size === "lg" ? 22 : size === "md" ? 16 : 14;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", box, className)}
      style={{ color: fg, background: soft }}
    >
      <Icon size={glyph} strokeWidth={2.2} />
    </span>
  );
}
