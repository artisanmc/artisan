import { useState } from "react";
import type { Action, Menu } from "@/domain/types";

interface Props {
  action: Action;
  packMenus: Menu[];
  onChange: (next: Action) => void;
}

export function ActionBlock({ action, packMenus, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid="action-block-root"
      className="rounded-[6px] border border-[var(--line-soft)] bg-[var(--inset)] p-2"
    >
      {!expanded ? (
        <button
          type="button"
          data-testid="action-block-summary"
          onClick={() => setExpanded(true)}
          className="w-full text-left text-[12px] text-[var(--ink)]"
        >
          <span className="font-mono text-[var(--ink-mut)]">{action.type}</span>
          {" · "}
          <ActionSummary action={action} packMenus={packMenus} />
        </button>
      ) : (
        <div
          data-testid="action-block-form"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") setExpanded(false);
          }}
        >
          <ActionEditForm action={action} packMenus={packMenus} onChange={onChange} />
          <button
            type="button"
            className="btn btn-sm mt-2"
            onClick={() => setExpanded(false)}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function ActionSummary({
  action,
  packMenus,
}: {
  action: Action;
  packMenus: Menu[];
}) {
  if (action.type === "open_menu") {
    const target = packMenus.find((m) => m.id === action.menuId);
    return <span>{target?.name ?? action.menuId ?? "—"}</span>;
  }
  if (action.type === "open_dialog") {
    return <span className="text-[var(--ink-faint)]">{action.dialogId}</span>;
  }
  if (action.type === "run_command") {
    return <span className="text-[var(--ink-faint)]">/{action.command}</span>;
  }
  if (action.type === "send_message") {
    return <span className="text-[var(--ink-faint)]">message</span>;
  }
  if (action.type === "show_title") {
    return <span className="text-[var(--ink-faint)]">title</span>;
  }
  if (action.type === "give_item") {
    return (
      <span className="text-[var(--ink-faint)]">
        {action.count}× {action.material}
      </span>
    );
  }
  if (action.type === "take_money") {
    return <span className="text-[var(--ink-faint)]">{action.amount}</span>;
  }
  if (action.type === "paginate") {
    return <span className="text-[var(--ink-faint)]">{action.direction}</span>;
  }
  if (action.type === "set_arg") {
    return (
      <span className="text-[var(--ink-faint)]">
        {action.arg} = {action.value}
      </span>
    );
  }
  if (action.type === "set_arg_cycle_next" || action.type === "set_arg_cycle_prev") {
    return <span className="text-[var(--ink-faint)]">{action.arg}</span>;
  }
  return <span className="text-[var(--ink-faint)]">…</span>;
}

function ActionEditForm({ action, packMenus, onChange }: Props) {
  if (action.type === "open_menu") {
    return (
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">Target menu</span>
        <select
          className="input"
          value={action.menuId ?? ""}
          onChange={(e) =>
            onChange({ ...action, menuId: e.target.value } as Action)
          }
        >
          <option value="">— none —</option>
          {packMenus.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <p className="text-[12px] text-[var(--ink-faint)]">
      Form for {action.type} not yet implemented.
    </p>
  );
}
