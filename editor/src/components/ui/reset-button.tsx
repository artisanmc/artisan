import { cn } from "@/lib/cx";
import { RotateCcw } from "lucide-react";
import { Tooltip } from "./tooltip";

export interface ResetButtonProps {
  /** The field differs from its original: the button is live. Otherwise disabled, which says "unchanged". */
  modified: boolean;
  onReset: () => void;
  /** Accessible name and tooltip, e.g. "Back to the module's value". */
  label: string;
  className?: string;
}

/**
 * The small reset beside a field that starts from an original value (a module's
 * command, a system element): enabled only while the field differs from it, so the
 * enabled ones show at a glance what was changed.
 */
function ResetButton({ modified, onReset, label, className }: ResetButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={!modified}
      onClick={onReset}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors",
        modified
          ? "text-[var(--brand)] hover:bg-[var(--surface-hover)]"
          : "cursor-default text-[var(--text-faint)] opacity-40",
        className,
      )}
    >
      <RotateCcw className="size-3.5" aria-hidden />
    </button>
  );
  return modified ? <Tooltip content={label}>{button}</Tooltip> : button;
}

export { ResetButton };
