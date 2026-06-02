import { useState, useRef, useEffect } from "react";
import type { Step } from "@/domain/types";
import { useTranslation } from "react-i18next";

interface Props {
  onAdd: (step: Step) => void;
}

const ACTION_TYPES = [
  "open_menu",
  "close_menu",
  "send_message",
  "run_command",
] as const;

export function AddActionButton({ onAdd }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const addAction = (type: (typeof ACTION_TYPES)[number]) => {
    onAdd({ kind: "action", action: { type } as any });
    setOpen(false);
  };

  const addIf = () => {
    onAdd({ kind: "if", cases: [{ conditions: [], steps: [] }] } as Step);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        + {t("addActionButton.add")}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-10 mt-1 flex min-w-[180px] flex-col rounded-md border border-[var(--line)] bg-[var(--bg)] py-1 shadow-md"
        >
          {ACTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="px-3 py-1 text-left text-[12px] hover:bg-[var(--hover)]"
              onClick={() => addAction(type)}
            >
              {type}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--line-soft)]" />
          <button
            type="button"
            role="menuitem"
            className="px-3 py-1 text-left text-[12px] hover:bg-[var(--hover)]"
            onClick={addIf}
          >
            if
          </button>
        </div>
      )}
    </div>
  );
}
