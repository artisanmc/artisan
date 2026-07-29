import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cx";

export interface CollapsibleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Trigger label. */
  title: React.ReactNode;
  /** Trailing trigger content — counts, badges, a summary of what's inside. */
  meta?: React.ReactNode;
  /** Uncontrolled initial state. Ignored when `open` is provided. */
  defaultOpen?: boolean;
  /** Controlled state — pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Disclosure section: a full-width trigger row that reveals its children.
 *
 * Content is unmounted while closed, so the collapsed state costs nothing —
 * which is the point for heavy sections (an item's advanced parameters) that
 * most users never open.
 */
function Collapsible({
  title,
  meta,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const isOpen = open ?? uncontrolled;
  const contentId = React.useId();

  function toggle() {
    const next = !isOpen;
    if (open === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="flex items-center gap-1.5 py-1.5 text-left text-[13px] text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
      >
        <ChevronRight
          size={14}
          className={cn("shrink-0 transition-transform", isOpen && "rotate-90")}
          aria-hidden
        />
        <span className="font-medium">{title}</span>
        {meta ? <span className="ml-auto flex items-center gap-1.5">{meta}</span> : null}
      </button>
      {isOpen ? (
        <div id={contentId} className="pt-1 pb-2 pl-[19px]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export { Collapsible };
