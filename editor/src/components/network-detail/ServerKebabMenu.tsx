import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Action = "edit" | "relink" | "history" | "allowlist" | "delete";

interface Props {
  serverId: string;
  onAction: (action: Action, serverId: string) => void;
}

export function ServerKebabMenu({ serverId, onAction }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const item = (action: Action, label: string, danger = false) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      className={`px-3 py-1.5 text-left text-[12px] hover:bg-[var(--surface-hover)] ${danger ? "text-[var(--danger)]" : ""}`}
      onClick={() => {
        onAction(action, serverId);
        setOpen(false);
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-icon btn-sm btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("serverKebab.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 flex min-w-[200px] flex-col rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-md"
        >
          {item("edit", t("serverKebab.edit"))}
          {item("relink", t("serverKebab.relink"))}
          <div className="my-1 border-t border-[var(--border-soft)]" />
          {item("history", t("serverKebab.history"))}
          {item("allowlist", t("serverKebab.allowlist"))}
          <div className="my-1 border-t border-[var(--border-soft)]" />
          {item("delete", t("serverKebab.delete"), true)}
        </div>
      )}
    </div>
  );
}
