import { useId } from "react";
import type { JsonSchema, SchemaFormProps, ObjectSchema, ArraySchema } from "./types";

export function SchemaForm({ schema, value, onChange, widgets }: SchemaFormProps) {
  return <FieldRouter schema={schema} value={value} onChange={onChange} widgets={widgets} />;
}

interface FieldProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  widgets?: SchemaFormProps["widgets"];
  fieldId?: string;
}

function FieldRouter(p: FieldProps) {
  switch (p.schema.type) {
    case "string":
      return <StringField {...p} />;
    case "number":
    case "integer":
      return <NumberField {...p} />;
    case "boolean":
      return <BooleanField {...p} />;
    case "object":
      return <ObjectField {...p} schema={p.schema as ObjectSchema} />;
    case "array":
      return <ArrayField {...p} schema={p.schema as ArraySchema} />;
  }
}

function StringField({ schema, value, onChange, widgets, fieldId }: FieldProps) {
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const s = schema as Extract<JsonSchema, { type: "string" }>;
  const custom = s.format && widgets?.[s.format];
  if (custom) {
    const Widget = custom;
    return <Widget value={value} onChange={onChange} schema={schema} />;
  }
  if (s.enum) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {s.title && <span>{s.title}</span>}
        <select
          id={id}
          aria-label={s.title}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1"
        >
          {s.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (s.format === "long") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {s.title && <span>{s.title}</span>}
        <textarea
          id={id}
          aria-label={s.title}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-20 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1"
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {s.title && <span>{s.title}</span>}
      <input
        id={id}
        aria-label={s.title}
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1"
      />
    </label>
  );
}

function NumberField({ schema, value, onChange, fieldId }: FieldProps) {
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const s = schema as Extract<JsonSchema, { type: "number" | "integer" }>;
  return (
    <label className="flex flex-col gap-1 text-sm">
      {s.title && <span>{s.title}</span>}
      <input
        id={id}
        aria-label={s.title}
        type="number"
        value={Number(value ?? 0)}
        step={s.type === "integer" ? 1 : "any"}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1"
      />
    </label>
  );
}

function BooleanField({ schema, value, onChange, fieldId }: FieldProps) {
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const s = schema as Extract<JsonSchema, { type: "boolean" }>;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        id={id}
        aria-label={s.title}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
      {s.title && <span>{s.title}</span>}
    </label>
  );
}

function ObjectField({ schema, value, onChange, widgets }: FieldProps & { schema: ObjectSchema }) {
  const obj = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-2">
      {schema.title && <h3 className="text-sm font-semibold">{schema.title}</h3>}
      {Object.entries(schema.properties).map(([key, propSchema]) => (
        <FieldRouter
          key={key}
          schema={propSchema}
          value={obj[key]}
          onChange={(v) => onChange({ ...obj, [key]: v })}
          widgets={widgets}
        />
      ))}
    </div>
  );
}

function ArrayField({ schema, value, onChange, widgets }: FieldProps & { schema: ArraySchema }) {
  const arr = (Array.isArray(value) ? value : []) as unknown[];
  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--border-soft)] p-2">
      {schema.title && <h3 className="text-sm font-semibold">{schema.title}</h3>}
      {arr.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are raw JSON values with no stable id; the field is position-addressed (edits write next[i])
        <div key={i} className="flex items-start gap-2">
          <FieldRouter
            schema={schema.items}
            value={item}
            onChange={(v) => {
              const next = [...arr];
              next[i] = v;
              onChange(next);
            }}
            widgets={widgets}
          />
          <button
            type="button"
            onClick={() => onChange(arr.filter((_, j) => j !== i))}
            className="text-[var(--text-faint)] hover:text-[var(--danger)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...arr, undefined])}
        className="self-start text-sm text-[var(--text-mut)] hover:text-[var(--text)]"
      >
        + Add
      </button>
    </div>
  );
}
