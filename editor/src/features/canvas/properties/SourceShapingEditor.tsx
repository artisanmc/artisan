import { Input } from "@/components/ui/input";
import type { ContextInput } from "@/domain/types";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

interface SourceShapingEditorProps {
  input: SourceRefInput;
  /** Declared field names from the server schema — [] falls back to free input. */
  schemaFields: string[];
  /** Menu arg names, offered as `{arg}` value suggestions. */
  argNames: string[];
  onChange: (patch: Partial<SourceRefInput>) => void;
}

/**
 * Visual editor over the existing runtime shaping (`filter` equality +
 * `{arg}` interpolation, single-key `sort`, `limit`) — no runtime change,
 * imported YAML values become editable and round-trip unchanged.
 */
export function SourceShapingEditor({ input, schemaFields, argNames, onChange }: SourceShapingEditorProps) {
  const { t } = useTranslation();
  const fieldsListId = useId();
  const valuesListId = useId();
  // Local entries: editing a field name must not collapse rows with equal
  // interim names — the record is rebuilt on every emit.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(input.filter ?? {}));
  useEffect(() => {
    setRows(Object.entries(input.filter ?? {}));
    // Re-sync when the input identity changes (source picked / row re-created).
  }, [input.ref, input.name]);

  const emit = (next: [string, string][]) => {
    setRows(next);
    const named = next.filter(([k]) => k !== "");
    onChange({ filter: named.length > 0 ? Object.fromEntries(named) : undefined });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] pt-1.5">
      <datalist id={fieldsListId} data-testid="filter-field-options">
        {schemaFields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id={valuesListId} data-testid="filter-value-options">
        {argNames.map((a) => (
          <option key={a} value={`{${a}}`} />
        ))}
      </datalist>

      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.filterSection")}
      </div>
      {rows.map(([field, value], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
        <div key={i} className="flex items-center gap-1.5">
          <Input
            data-testid="filter-field"
            value={field}
            list={fieldsListId}
            placeholder={t("menuProperties.filterFieldPlaceholder")}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            className="h-7 w-24 px-2 py-0 font-mono text-xs"
          />
          <span className="text-[10px] text-[var(--text-faint)]">=</span>
          <Input
            data-testid="filter-value"
            value={value}
            list={valuesListId}
            placeholder={t("menuProperties.filterValuePlaceholder")}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            className="h-7 flex-1 px-2 py-0 font-mono text-xs"
          />
          <button
            type="button"
            title={t("menuProperties.filterRemove")}
            onClick={() => emit(rows.filter((_, j) => j !== i))}
            className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="filter-add"
        onClick={() => emit([...rows, ["", ""]])}
        className="self-start rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("menuProperties.filterAdd")}
      </button>

      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("menuProperties.sortLabel")}:</span>
        <Input
          data-testid="sort-by"
          value={input.sort?.by ?? ""}
          list={fieldsListId}
          placeholder={t("menuProperties.sortNone")}
          onChange={(e) =>
            onChange({
              sort: e.target.value === "" ? undefined : { by: e.target.value, direction: input.sort?.direction ?? "asc" },
            })
          }
          className="h-7 w-24 px-2 py-0 font-mono text-xs"
        />
        <select
          data-testid="sort-direction"
          value={input.sort?.direction ?? "asc"}
          disabled={!input.sort?.by}
          onChange={(e) =>
            input.sort?.by
              ? onChange({ sort: { by: input.sort.by, direction: e.target.value as "asc" | "desc" } })
              : undefined
          }
          className="h-7 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)] disabled:opacity-40"
        >
          <option value="asc">{t("menuProperties.sortAsc")}</option>
          <option value="desc">{t("menuProperties.sortDesc")}</option>
        </select>
        <span className="ml-2 font-mono text-[10px] text-[var(--text-faint)]">{t("menuProperties.limitLabel")}:</span>
        <Input
          data-testid="limit-input"
          type="number"
          min={1}
          value={input.limit ?? ""}
          onChange={(e) => onChange({ limit: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="h-7 w-16 px-2 py-0 font-mono text-xs"
        />
      </div>
    </div>
  );
}
