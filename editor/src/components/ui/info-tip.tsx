import { Info } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/cx";
import { Tooltip } from "./tooltip";

export interface InfoTipProps {
  /** What a reader may need to understand the thing beside it. Also its accessible name. */
  content: React.ReactNode;
  /** The button's accessible name when `content` is not plain text. */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * A small ⓘ beside a title or a row: the explanation stays in a tooltip instead of a paragraph
 * under it, so a screen reads by its titles and only the reader who wonders opens the rest.
 */
function InfoTip({ content, label, side = "bottom", className }: InfoTipProps) {
  return (
    <Tooltip content={content} side={side}>
      <button
        type="button"
        aria-label={label ?? (typeof content === "string" ? content : undefined)}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--text-faint)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
          className,
        )}
      >
        <Info size={12} aria-hidden />
      </button>
    </Tooltip>
  );
}

export { InfoTip };
