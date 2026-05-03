import { Input } from "@/components/ui/input";
import type { FieldType } from "@/domain/types";
import { useTranslation } from "react-i18next";

const PRIMITIVE_KINDS = ["string", "number", "integer", "boolean"] as const;

interface FieldTypeBuilderProps {
  type: FieldType;
  onChange: (next: FieldType) => void;
  /** Indent level for visual nesting; defaults to 0. */
  depth?: number;
}

/**
 * Recursive FieldType editor. The user picks a kind; for compound kinds
 * (list, object) sub-editors are inlined for the inner type / fields.
 *
 * Used by SchemaEditor at the top level and by FieldsEditor for each
 * field's type.
 */
export function FieldTypeBuilder({ type, onChange, depth = 0 }: FieldTypeBuilderProps) {
  const { t } = useTranslation();
  const indent = { paddingLeft: `${depth * 12}px` };

  const setKind = (kind: FieldType["kind"]) => {
    switch (kind) {
      case "string":
      case "number":
      case "integer":
      case "boolean":
        onChange({ kind } as FieldType);
        return;
      case "list":
        onChange({ kind: "list", of: { kind: "string" } });
        return;
      case "object":
        onChange({ kind: "object", fields: [] });
        return;
    }
  };

  return (
    <div className="flex flex-col gap-1" style={indent}>
      <select
        value={type.kind}
        onChange={(e) => setKind(e.target.value as FieldType["kind"])}
        className="h-7 w-32 rounded border border-zinc-700 bg-zinc-900 px-1 text-[11px]"
      >
        {PRIMITIVE_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value="list">list</option>
        <option value="object">object</option>
      </select>
      {type.kind === "list" ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase text-zinc-500">
            {t("dataSources.listOf")}
          </div>
          <FieldTypeBuilder
            type={type.of}
            onChange={(of) => onChange({ kind: "list", of })}
            depth={depth + 1}
          />
        </div>
      ) : null}
      {type.kind === "object" ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase text-zinc-500">
            {t("dataSources.objectFields")}
          </div>
          <FieldsEditor
            fields={type.fields}
            onChange={(fields) => onChange({ kind: "object", fields })}
            depth={depth + 1}
          />
        </div>
      ) : null}
    </div>
  );
}

function FieldsEditor({
  fields,
  onChange,
  depth,
}: {
  fields: { name: string; type: FieldType }[];
  onChange: (next: { name: string; type: FieldType }[]) => void;
  depth: number;
}) {
  const { t } = useTranslation();
  const updateAt = (i: number, patch: Partial<{ name: string; type: FieldType }>) => {
    const next = fields.slice();
    const current = next[i];
    if (!current) return;
    next[i] = { ...current, ...patch };
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: field order is the identity here
        <div key={i} className="flex flex-col gap-1 border border-zinc-800 bg-zinc-900 p-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              value={f.name}
              onChange={(e) => updateAt(i, { name: e.target.value })}
              placeholder={t("dataSources.fieldName")}
              className="h-7 w-32 px-1.5 py-0 font-mono text-[11px]"
            />
            <button
              type="button"
              onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
              className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
            >
              ×
            </button>
          </div>
          <FieldTypeBuilder
            type={f.type}
            onChange={(type) => updateAt(i, { type })}
            depth={depth}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...fields, { name: "", type: { kind: "string" } }])}
        className="self-start rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        {t("dataSources.addField")}
      </button>
    </div>
  );
}
