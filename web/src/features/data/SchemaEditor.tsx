import { Input } from "@/components/ui/input";
import type { DataSource, FieldType, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";

interface SchemaEditorProps {
  packId: PackId;
  source: DataSource;
}

const PRIMITIVE_KINDS = ["string", "number", "integer", "boolean"] as const;
type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

export function SchemaEditor({ packId, source }: SchemaEditorProps) {
  const { t } = useTranslation();
  const setSchema = useAccountStore((s) => s.setPackDataSourceSchema);

  // For MVP, derive a "shape" from the type:
  //  - list-of-primitive
  //  - list-of-object
  //  - object
  // Anything else is "advanced" and shown read-only with a fallback message.
  const shape = detectMvpShape(source.type);

  if (shape === "advanced") {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
        {t("dataSources.advancedSchemaNotice")}
      </div>
    );
  }

  if (shape === "list-of-primitive") {
    const innerKind = (source.type as Extract<FieldType, { kind: "list" }>).of.kind;
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.schema")}
        </div>
        <div className="flex items-center gap-2">
          <span>{t("dataSources.listOf")}</span>
          <select
            value={innerKind}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__object") {
                setSchema({
                  packId,
                  id: source.id,
                  type: { kind: "list", of: { kind: "object", fields: [] } },
                });
              } else {
                setSchema({
                  packId,
                  id: source.id,
                  type: { kind: "list", of: { kind: val as PrimitiveKind } },
                });
              }
            }}
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
          >
            {PRIMITIVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="__object">{t("dataSources.object")}</option>
          </select>
        </div>
      </div>
    );
  }

  if (shape === "list-of-object") {
    const objType = (source.type as Extract<FieldType, { kind: "list" }>).of as Extract<
      FieldType,
      { kind: "object" }
    >;
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.schema")}: {t("dataSources.listOfObjectWith")} {objType.fields.length}{" "}
          {t("dataSources.fields")}
        </div>
        <FieldsEditor
          fields={objType.fields}
          onChange={(fields) =>
            setSchema({
              packId,
              id: source.id,
              type: { kind: "list", of: { kind: "object", fields } },
            })
          }
        />
      </div>
    );
  }

  // shape === "object"
  const objType = source.type as Extract<FieldType, { kind: "object" }>;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
      <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
        {t("dataSources.schema")}: {t("dataSources.objectWith")} {objType.fields.length}{" "}
        {t("dataSources.fields")}
      </div>
      <FieldsEditor
        fields={objType.fields}
        onChange={(fields) =>
          setSchema({ packId, id: source.id, type: { kind: "object", fields } })
        }
      />
    </div>
  );
}

function FieldsEditor({
  fields,
  onChange,
}: {
  fields: { name: string; type: FieldType }[];
  onChange: (next: { name: string; type: FieldType }[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {fields.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: field order is the identity here
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={f.name}
            onChange={(e) => {
              const next = fields.slice();
              next[i] = { ...f, name: e.target.value };
              onChange(next);
            }}
            placeholder={t("dataSources.fieldName")}
            className="h-7 w-32 px-1.5 py-0 font-mono text-[11px]"
          />
          <select
            value={f.type.kind}
            onChange={(e) => {
              const next = fields.slice();
              next[i] = { ...f, type: { kind: e.target.value as PrimitiveKind } };
              onChange(next);
            }}
            className="h-7 rounded border border-zinc-700 bg-zinc-900 px-1 text-[11px]"
          >
            {PRIMITIVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
            className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
          >
            ×
          </button>
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

function detectMvpShape(
  type: FieldType,
): "list-of-primitive" | "list-of-object" | "object" | "advanced" {
  if (type.kind === "object") {
    if (type.fields.every((f) => isPrimitiveKind(f.type.kind))) return "object";
    return "advanced";
  }
  if (type.kind === "list") {
    if (isPrimitiveKind(type.of.kind)) return "list-of-primitive";
    if (type.of.kind === "object" && type.of.fields.every((f) => isPrimitiveKind(f.type.kind)))
      return "list-of-object";
    return "advanced";
  }
  return "advanced";
}

function isPrimitiveKind(kind: FieldType["kind"]): kind is PrimitiveKind {
  return kind === "string" || kind === "number" || kind === "integer" || kind === "boolean";
}
