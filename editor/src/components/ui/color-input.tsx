import { cn } from "@/lib/cx";

const HEX = /^#[0-9a-f]{6}$/i;

export interface ColorInputProps {
  /** `#rrggbb`; anything else shows as white until a colour is picked. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Colour of primary". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** A colour picked in the browser's own picker, shown as a square swatch beside its field. */
function ColorInput({ value, onChange, label, disabled, className }: ColorInputProps) {
  return (
    <input
      type="color"
      aria-label={label}
      disabled={disabled}
      value={HEX.test(value) ? value.toLowerCase() : "#ffffff"}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "size-8 shrink-0 cursor-pointer rounded-[8px] border border-[var(--border)] bg-transparent p-0 disabled:cursor-default disabled:opacity-50",
        className,
      )}
    />
  );
}

export { ColorInput };
