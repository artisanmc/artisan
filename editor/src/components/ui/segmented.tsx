import { cx } from "@/lib/cx";

/**
 * A choice among a few values, side by side (inventory type, rows…): one track, the
 * picked value raised in the brand colour. Each option is a toggle (`aria-pressed`).
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name. */
  label: string;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form fieldset
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex max-w-full flex-wrap gap-0.5 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-inset)] p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            className={cx(
              "min-w-8 rounded-[calc(var(--r-sm)-2px)] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              on
                ? "bg-[var(--brand-soft)] text-[var(--brand)] shadow-[inset_0_0_0_1px_var(--brand-line)]"
                : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
