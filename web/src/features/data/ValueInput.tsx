import { Input } from "@/components/ui/input";
import type { FieldType } from "@/domain/types";
import { useTranslation } from "react-i18next";
import { defaultValueForFieldType } from "./helpers";

interface ValueInputProps {
  type: FieldType;
  value: unknown;
  onChange: (next: unknown) => void;
  depth?: number;
}

/**
 * Recursive value editor driven by a FieldType. Flat primitives render
 * as inputs / checkboxes. List values render as repeated rows. Object
 * values render as labeled sub-forms. Both list and object recurse via
 * <ValueInput> for inner shapes.
 */
export function ValueInput({ type, value, onChange, depth = 0 }: ValueInputProps) {
  const { t } = useTranslation();

  switch (type.kind) {
    case "string":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-40 px-2 py-0 font-mono text-[11px]"
        />
      );
    case "number":
    case "integer":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          className="h-7 w-32 px-2 py-0 font-mono text-[11px]"
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
      );
    case "list": {
      const items = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items ordered by index
            <div key={i} className="flex items-start gap-1.5 border border-zinc-800 p-1">
              <ValueInput
                type={type.of}
                value={item}
                onChange={(nv) => {
                  const next = items.slice();
                  next[i] = nv;
                  onChange(next);
                }}
                depth={depth + 1}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, defaultValueForFieldType(type.of)])}
            className="self-start rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addItem")}
          </button>
        </div>
      );
    }
    case "object": {
      const obj =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return (
        <div className="flex flex-col gap-1.5">
          {type.fields.map((f) => (
            <div key={f.name} className="flex items-start gap-2">
              <span className="w-24 shrink-0 pt-1 font-mono text-[11px] text-zinc-400">
                {f.name}
              </span>
              <div className="flex-1">
                <ValueInput
                  type={f.type}
                  value={obj[f.name]}
                  onChange={(nv) => onChange({ ...obj, [f.name]: nv })}
                  depth={depth + 1}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}
