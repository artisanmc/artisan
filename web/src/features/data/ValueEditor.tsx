import { Input } from "@/components/ui/input";
import type { DataSource, FieldType, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";

interface ValueEditorProps {
  packId: PackId;
  source: DataSource;
}

export function ValueEditor({ packId, source }: ValueEditorProps) {
  const { t } = useTranslation();
  const setValue = useAccountStore((s) => s.setPackDataSourceValue);

  if (source.type.kind === "list" && isPrimitiveKind(source.type.of.kind)) {
    const items = Array.isArray(source.value) ? (source.value as unknown[]) : [];
    const inner = source.type.of.kind;
    const update = (next: unknown[]) => setValue({ packId, id: source.id, value: next });
    return (
      <div className="space-y-1">
        {items.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items ordered by index
          <div key={i} className="flex items-center gap-1.5">
            <PrimitiveInput
              kind={inner}
              value={v}
              onChange={(nv) => {
                const next = items.slice();
                next[i] = nv;
                update(next);
              }}
            />
            <button
              type="button"
              onClick={() => update(items.filter((_, idx) => idx !== i))}
              className="h-6 w-6 text-zinc-500 hover:text-rose-300"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, defaultPrimitive(inner)])}
          className="self-start rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {t("dataSources.addItem")}
        </button>
      </div>
    );
  }

  if (
    source.type.kind === "list" &&
    source.type.of.kind === "object" &&
    source.type.of.fields.every((f) => isPrimitiveKind(f.type.kind))
  ) {
    const objType = source.type.of;
    const items = Array.isArray(source.value) ? (source.value as Record<string, unknown>[]) : [];
    const update = (next: Record<string, unknown>[]) =>
      setValue({ packId, id: source.id, value: next });
    return (
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-zinc-500">
            {objType.fields.map((f) => (
              <th key={f.name} className="border-b border-zinc-800 px-2 py-1 font-mono">
                {f.name} <span className="text-zinc-600">({f.type.kind})</span>
              </th>
            ))}
            <th className="border-b border-zinc-800 px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: table rows ordered by index
            <tr key={i}>
              {objType.fields.map((f) => (
                <td key={f.name} className="border-b border-zinc-900 px-2 py-1">
                  <PrimitiveInput
                    kind={f.type.kind as Exclude<FieldType["kind"], "list" | "object">}
                    value={row[f.name]}
                    onChange={(nv) => {
                      const next = items.slice();
                      next[i] = { ...row, [f.name]: nv };
                      update(next);
                    }}
                  />
                </td>
              ))}
              <td className="border-b border-zinc-900 px-2 py-1">
                <button
                  type="button"
                  onClick={() => update(items.filter((_, idx) => idx !== i))}
                  className="h-6 w-6 text-zinc-500 hover:text-rose-300"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={objType.fields.length + 1} className="px-2 py-2">
              <button
                type="button"
                onClick={() => {
                  const newRow: Record<string, unknown> = {};
                  for (const f of objType.fields)
                    newRow[f.name] = defaultPrimitive(
                      f.type.kind as "string" | "number" | "integer" | "boolean",
                    );
                  update([...items, newRow]);
                }}
                className="rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                {t("dataSources.addRow")}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (
    source.type.kind === "object" &&
    source.type.fields.every((f) => isPrimitiveKind(f.type.kind))
  ) {
    const obj = (source.value as Record<string, unknown> | undefined) ?? {};
    const update = (next: Record<string, unknown>) =>
      setValue({ packId, id: source.id, value: next });
    return (
      <div className="space-y-1">
        {source.type.fields.map((f) => (
          <div key={f.name} className="flex items-center gap-2">
            <span className="w-24 font-mono text-[11px] text-zinc-400">{f.name}</span>
            <PrimitiveInput
              kind={f.type.kind as Exclude<FieldType["kind"], "list" | "object">}
              value={obj[f.name]}
              onChange={(nv) => update({ ...obj, [f.name]: nv })}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
      {t("dataSources.advancedValueNotice")}
    </div>
  );
}

function isPrimitiveKind(
  kind: FieldType["kind"],
): kind is "string" | "number" | "integer" | "boolean" {
  return kind === "string" || kind === "number" || kind === "integer" || kind === "boolean";
}

function defaultPrimitive(kind: "string" | "number" | "integer" | "boolean"): unknown {
  switch (kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
  }
}

function PrimitiveInput({
  kind,
  value,
  onChange,
}: {
  kind: "string" | "number" | "integer" | "boolean";
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (kind === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    );
  }
  if (kind === "integer" || kind === "number") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="h-7 w-24 px-2 py-0 font-mono text-[11px]"
      />
    );
  }
  // string
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-32 px-2 py-0 font-mono text-[11px]"
    />
  );
}
