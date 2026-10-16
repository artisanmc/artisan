/** Section of an inspector editor: a small uppercase caption above its content. */
export function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Caption of a single field inside an inspector editor. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[10px] text-[var(--text-faint)] uppercase">{children}</div>
  );
}
