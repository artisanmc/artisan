import { Input } from "@/components/ui/input";
import { useMenuDraftStore } from "@/state/menuDraftStore";

export function Properties() {
  const draft = useMenuDraftStore((s) => s.draft);
  const selectedId = useMenuDraftStore((s) => s.selectedElementId);
  const setField = useMenuDraftStore((s) => s.setElementField);

  const element = draft?.layers.flatMap((l) => l.elements).find((e) => e.id === selectedId);
  const appearance = element?.appearances[0];

  return (
    <aside className="flex w-72 flex-col gap-3 border-l border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="text-xs uppercase text-zinc-500">Properties</div>
      {!element ? (
        <div className="text-xs text-zinc-500">Select a slot to edit.</div>
      ) : (
        <>
          <Field label="material" value={appearance?.material ?? ""} disabled />
          <Field
            label="title"
            value={appearance?.title ?? ""}
            onChange={(v) => setField({ elementId: element.id, field: "title", value: v })}
          />
          <Field
            label="count"
            value={String(appearance?.count ?? 1)}
            onChange={(v) => setField({ elementId: element.id, field: "count", value: v })}
          />
          <div>
            <div className="mb-1 text-[10px] uppercase text-zinc-500">lore</div>
            <textarea
              className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
              rows={4}
              value={(appearance?.lore ?? []).join("\n")}
              onChange={(e) =>
                setField({ elementId: element.id, field: "lore", value: e.target.value })
              }
            />
          </div>
        </>
      )}
    </aside>
  );
}

interface FieldProps {
  label: string;
  value: string;
  disabled?: boolean;
  onChange?: (v: string) => void;
}

function Field({ label, value, disabled, onChange }: FieldProps) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-zinc-500">{label}</div>
      <Input
        value={value}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </div>
  );
}
