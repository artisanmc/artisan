import type * as React from "react";

/** A titled block of a statistics tab: a chart, a ranking, a table. */
export function Panel({
  title,
  hint,
  actions,
  children,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13.5px] font-semibold text-[var(--text)]">{title}</h3>
        {hint != null && <span className="text-[12px] text-[var(--text-faint)]">{hint}</span>}
        {actions != null && <span className="ml-auto">{actions}</span>}
      </div>
      {children}
    </section>
  );
}
