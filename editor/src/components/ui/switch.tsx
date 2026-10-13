import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cx";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * On/off switch for a saved setting. For merely hiding a preview (UI state),
 * the lists' eye toggle stays the norm.
 */
export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[var(--brand)] bg-[var(--brand)]"
          : "border-[var(--border-strong)] bg-[var(--surface-raised-2)]",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "block size-3 rounded-full bg-[var(--surface)] transition-transform",
          checked ? "translate-x-3" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
