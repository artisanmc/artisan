import { cn } from "@/lib/cx";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Optional secondary line under the title. */
  hint?: React.ReactNode;
  /** Optional action (e.g. a Button) rendered under the text. */
  action?: React.ReactNode;
}

/**
 * Centered empty/no-results placeholder. Replaces the repeated
 * "flex center + faint text" pattern across panels and grids.
 */
function EmptyState({ icon: Icon, title, hint, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-[22px] text-[var(--text-faint)]" aria-hidden />}
      <span className="text-[13px] text-[var(--text-mut)]">{title}</span>
      {hint != null && <span className="text-[11.5px] text-[var(--text-faint)]">{hint}</span>}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
