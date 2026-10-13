import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cx";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Native checkbox, tinted by the brand token. For an explicitly confirmed
 * form state; a persistent setting that changes the in-game result uses
 * `<Switch>` instead.
 */
export function Checkbox({ className, checked, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-[4px] accent-[var(--brand)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
