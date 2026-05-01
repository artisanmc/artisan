import { Input } from "@/components/ui/input";
import type { Action, MenuId } from "@/domain/types";
import type { PackId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useAccountStore } from "@/state/accountStore";

interface ActionEditorProps {
  packId: PackId;
  action: Action;
  onChange: (action: Action) => void;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

/**
 * Per-type editor for a click/command Action. Render fields specific to the
 * action's discriminator and call back with the new action object on every
 * edit (immer/zundo handles undo on the store side).
 */
export function ActionEditor({ packId, action, onChange }: ActionEditorProps) {
  switch (action.type) {
    case "open_menu":
      return <OpenMenuEditor packId={packId} action={action} onChange={onChange} />;
    case "close_menu":
      return (
        <div className="text-[11px] text-zinc-500">Closes the active menu — no parameters.</div>
      );
    case "run_command":
      return <RunCommandEditor action={action} onChange={onChange} />;
    case "send_message":
      return <SendMessageEditor action={action} onChange={onChange} />;
    case "give_item":
      return <GiveItemEditor action={action} onChange={onChange} />;
    case "take_money":
      return <TakeMoneyEditor action={action} onChange={onChange} />;
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] uppercase text-zinc-500">{children}</div>;
}

function OpenMenuEditor({
  packId,
  action,
  onChange,
}: {
  packId: PackId;
  action: Extract<Action, { type: "open_menu" }>;
  onChange: (a: Action) => void;
}) {
  const menus = useAccountStore((s) => s.account.packs.find((p) => p.id === packId)?.menus ?? []);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>target menu</FieldLabel>
        <select
          value={action.menuId}
          onChange={(e) => onChange({ ...action, menuId: e.target.value as MenuId })}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200"
        >
          {/* Allow keeping a value that no longer exists in the pack so the
              user can see the dangling ref instead of silently flipping to the
              first menu. */}
          {menus.some((m) => m.id === action.menuId) ? null : (
            <option value={action.menuId}>{action.menuId} (missing)</option>
          )}
          {menus.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} · {m.title}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={Boolean(action.clearContext)}
          onChange={(e) => onChange({ ...action, clearContext: e.target.checked || undefined })}
        />
        clear context (forget the parent menu's history)
      </label>
    </div>
  );
}

function RunCommandEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "run_command" }>;
  onChange: (a: Action) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>command</FieldLabel>
        <Input
          value={action.command}
          placeholder="spawn"
          onChange={(e) => onChange({ ...action, command: e.target.value })}
        />
        <div className="mt-1 text-[10px] text-zinc-500">
          No leading slash — the runtime adds it.
        </div>
      </div>
      <div>
        <FieldLabel>run as</FieldLabel>
        <div className="flex gap-2">
          {(["player", "console"] as const).map((mode) => {
            const active = action.as === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...action, as: mode })}
                className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                  active
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {mode}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SendMessageEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "send_message" }>;
  onChange: (a: Action) => void;
}) {
  return (
    <div>
      <FieldLabel>text (MiniMessage)</FieldLabel>
      <textarea
        className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
        rows={3}
        placeholder="<gold>Welcome!</gold>"
        value={action.text}
        onChange={(e) => onChange({ ...action, text: e.target.value })}
      />
      {looksLikeMiniMessage(action.text) ? (
        <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
          <span className="mr-2 text-[9px] uppercase text-zinc-600">preview</span>
          <MiniMessageInline source={action.text} className="font-mono text-xs" />
        </div>
      ) : null}
    </div>
  );
}

function GiveItemEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "give_item" }>;
  onChange: (a: Action) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>material</FieldLabel>
        <Input
          value={action.material}
          placeholder="DIAMOND"
          onChange={(e) => onChange({ ...action, material: e.target.value.toUpperCase() })}
        />
      </div>
      <div>
        <FieldLabel>count</FieldLabel>
        <Input
          type="number"
          min={1}
          max={64}
          value={action.count}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n >= 1 && n <= 64) onChange({ ...action, count: n });
          }}
        />
      </div>
    </div>
  );
}

function TakeMoneyEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "take_money" }>;
  onChange: (a: Action) => void;
}) {
  return (
    <div>
      <FieldLabel>amount</FieldLabel>
      <Input
        type="number"
        min={0}
        value={action.amount}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && n >= 0) onChange({ ...action, amount: n });
        }}
      />
    </div>
  );
}
