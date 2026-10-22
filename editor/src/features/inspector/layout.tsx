/** Section of an inspector editor: a short heading above its content. */
export function Lane({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="font-display text-[13.5px] font-bold text-[var(--text)] first-letter:uppercase">
          {label}
        </div>
        {hint ? (
          <div className="truncate text-[11.5px] text-[var(--text-faint)]">{hint}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Caption of a single field inside an inspector editor. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[12px] font-medium text-[var(--text-mut)] first-letter:uppercase">
      {children}
    </div>
  );
}
