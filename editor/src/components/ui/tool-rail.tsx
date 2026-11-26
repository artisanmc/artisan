import { cx } from "@/lib/cx";
import type { ComponentType, ReactNode } from "react";
import { Tooltip } from "./tooltip";

export interface RailTool<T extends string> {
  value: T;
  /** Its name: what a screen reader reads, and the bubble shows. */
  label: string;
  /** The key that picks it, shown beside its name. */
  shortcut?: string;
  icon: ComponentType<{ className?: string }>;
  /** Why it cannot be picked now. The tool stays focusable, so the bubble can say it. */
  disabled?: string;
}

/**
 * The tools of a workbench, one above the other beside what they act on (a row on a narrow
 * screen): icons alone, each a toggle (`aria-pressed`) named in a bubble with its key. One
 * tool is held at a time. `footer` sits under the tools: what they draw with.
 */
export function ToolRail<T extends string>({
  label,
  tools,
  value,
  onChange,
  footer,
  className,
}: {
  /** The group's accessible name. */
  label: string;
  tools: readonly RailTool<T>[];
  value: T;
  onChange: (value: T) => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of toggle buttons, not a form fieldset
    <div
      role="group"
      aria-label={label}
      className={cx("flex shrink-0 items-center gap-1 lg:flex-col", className)}
    >
      {tools.map(({ value: tool, label: name, shortcut, icon: Icon, disabled }) => {
        const on = tool === value;
        return (
          <Tooltip
            key={tool}
            side="right"
            content={disabled ?? (shortcut ? `${name} (${shortcut})` : name)}
          >
            <button
              type="button"
              aria-label={name}
              aria-pressed={on}
              aria-disabled={disabled ? true : undefined}
              onClick={() => {
                if (!disabled) onChange(tool);
              }}
              className={cx(
                "flex size-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] border transition-colors",
                on
                  ? "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-transparent text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
              )}
            >
              <Icon className="size-[18px]" />
            </button>
          </Tooltip>
        );
      })}
      {footer}
    </div>
  );
}
