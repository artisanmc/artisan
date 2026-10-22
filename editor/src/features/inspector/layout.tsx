/** Section of an inspector editor: a short heading above its content. */
export function Lane({
  label,
  hint,
  panel,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  /** Set the section off as a panel: the wide editors (command, dialog) stack these. */
  panel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={panel ? "panel mb-4 rounded-[var(--r-md)] p-4 last:mb-0" : "mb-5 last:mb-0"}>
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
