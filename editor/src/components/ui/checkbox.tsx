import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cx";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Case à cocher native, teintée par le token de marque. Pour un état de
 * formulaire explicitement confirmé ; un réglage persistant qui change le
 * résultat en jeu utilise plutôt `<Switch>`.
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
