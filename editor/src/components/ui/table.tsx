import { cx } from "@/lib/cx";
import * as React from "react";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...p }, ref) => (
    <div className="card overflow-auto p-0">
      <table
        ref={ref}
        className={cx("w-full border-collapse text-left text-[13px]", className)}
        {...p}
      />
    </div>
  ),
);
Table.displayName = "Table";

export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;

export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cx(
      "border-[var(--border-soft)] border-b hover:bg-[var(--surface-raised)]",
      className,
    )}
    {...p}
  />
);

export const TH = ({
  align = "left",
  className,
  ...p
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) => (
  <th
    className={cx("eyebrow px-3 py-2", align === "right" ? "text-right" : "text-left", className)}
    {...p}
  />
);

export const TD = ({
  align = "left",
  className,
  ...p
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) => (
  <td
    className={cx(
      "px-3 py-2",
      align === "right" ? "text-right tabular-nums" : "text-left",
      className,
    )}
    {...p}
  />
);
