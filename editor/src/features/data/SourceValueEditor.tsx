import { Input } from "@/components/ui/input";
import { sourceRootFields } from "@/domain/dataModels";
import type {
  DataModel,
  DataModelId,
  DataSource,
  LText,
  ModelFieldType,
  Project,
} from "@/domain/types";
import { MaterialRefField } from "@/features/canvas/MaterialRefField";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Recursive value editor for Project-source content, driven by the declared
 * schema. Scalars edit inline; `item` uses the material field kit; `ltext`
 * edits the active language through the normal LText write path; lists and
 * objects (incl. model refs) recurse. ADR `project-sources-and-data-models`.
 */

function isLTextNode(v: unknown): v is LText {
  return typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";
}

function resolveObjectFields(
  type: ModelFieldType,
  models: DataModel[],
  visited: Set<DataModelId> = new Set(),
): { name: string; type: ModelFieldType }[] | null {
  if (type.kind === "object") return type.fields;
  if (type.kind === "model") {
    if (visited.has(type.ref)) return null;
    const m = models.find((x) => x.id === type.ref);
    if (!m) return null;
    return m.fields;
  }
  return null;
}

interface RowKeyEditorProps {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number;
  fieldName: string;
  type: "string" | "number" | "integer";
  value: unknown;
}

function RowKeyEditor({ projectId, sourceId, row, fieldName, type, value }: RowKeyEditorProps) {
  const { t } = useTranslation();
  const setSourceValue = useAccountStore((s) => s.setSourceValue);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState<"required" | "duplicate" | null>(null);
  const errorId = `row-key-error-${sourceId}-${row}`;

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commit = () => {
    const result = setSourceValue({ projectId, sourceId, row, path: [fieldName], value: draft });
    if (result.ok) {
      setError(null);
      return;
    }
    setError(result.reason === "required_row_key" ? "required" : "duplicate");
    setDraft(String(value ?? ""));
  };

  return (
    <div>
      <Input
        type={type === "string" ? "text" : "number"}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={type === "string" ? "h-7 min-w-24 px-2 text-[12px]" : "h-7 w-24 px-2 text-[12px]"}
        aria-label={fieldName}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="text-[10px] text-[var(--danger)]">
          {t(error === "required" ? "dataSources.rowKeyRequired" : "dataSources.rowKeyDuplicate")}
        </p>
      ) : null}
    </div>
  );
}

function isRowKeyType(type: ModelFieldType): type is Extract<ModelFieldType, { kind: "string" | "number" | "integer" }> {
  return type.kind === "string" || type.kind === "number" || type.kind === "integer";
}

export function ValueEditor({
  projectId,
  sourceId,
  row,
  path,
  type,
  value,
  pack,
}: {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number | null;
  path: (string | number)[];
  type: ModelFieldType;
  value: unknown;
  pack: Project;
}) {
  const { t } = useTranslation();
  const setSourceValue = useAccountStore((s) => s.setSourceValue);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const addSourceListItem = useAccountStore((s) => s.addSourceListItem);
  const removeSourceListItem = useAccountStore((s) => s.removeSourceListItem);
  const activeLang = useUiStore((s) => s.activeLang);
  const models = pack.dataModels ?? [];
  const set = (v: unknown) => setSourceValue({ projectId, sourceId, row, path, value: v });

  switch (type.kind) {
    case "string":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => set(e.target.value)}
          className="h-7 min-w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
        />
      );
    case "number":
    case "integer":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            set(Number.isFinite(n) ? (type.kind === "integer" ? Math.round(n) : n) : 0);
          }}
          className="h-7 w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
          className="h-4 w-4 accent-[var(--brand)]"
          aria-label={String(path[path.length - 1])}
        />
      );
    case "item":
      return (
        <MaterialRefField
          projectId={projectId}
          value={typeof value === "string" ? value : ""}
          onChange={set}
        />
      );
    case "ltext": {
      // Sentinel ({key:""}) = not minted yet — mint runs on row/field add, so
      // this only shows transiently on non-conforming hand-imported data.
      if (!isLTextNode(value) || value.key === "")
        return <span className="text-[10px] text-[var(--text-faint)]">—</span>;
      return (
        <Input
          value={getText(pack, value, activeLang)}
          onChange={(e) =>
            setI18nValue({ projectId, lt: value, lang: activeLang, value: e.target.value })
          }
          className="h-7 min-w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
          data-lang={activeLang}
        />
      );
    }
    case "list": {
      const items = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-1" data-testid={`list-${path.join(".")}`}>
          {items.map((el, i) => (
            <div key={i} className="flex items-start gap-1">
              <ValueEditor
                projectId={projectId}
                sourceId={sourceId}
                row={row}
                path={[...path, i]}
                type={type.of}
                value={el}
                pack={pack}
              />
              <button
                type="button"
                onClick={() => removeSourceListItem({ projectId, sourceId, row, path, index: i })}
                className="mt-1 rounded px-1 text-[10px] text-[var(--text-faint)] hover:text-rose-300"
                aria-label={t("dataSources.removeItem")}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addSourceListItem({ projectId, sourceId, row, path })}
            className="btn-ghost h-6 self-start rounded px-2 text-[10px]"
          >
            {t("dataSources.addItem")}
          </button>
        </div>
      );
    }
    case "object":
    case "model": {
      const fields = resolveObjectFields(type, models);
      if (!fields) return <span className="text-[10px] text-[var(--text-faint)]">—</span>;
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return (
        <div className="flex flex-col gap-1 rounded border border-[var(--border-soft)] p-2">
          {fields.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate font-mono text-[10px] text-[var(--text-faint)]">
                {f.name}
              </span>
              <ValueEditor
                projectId={projectId}
                sourceId={sourceId}
                row={row}
                path={[...path, f.name]}
                type={f.type}
                value={obj[f.name]}
                pack={pack}
              />
            </div>
          ))}
        </div>
      );
    }
  }
}

/** Rows table of a Table source: one column per top-level field. */
export function SourceRowsTable({
  projectId,
  pack,
  source,
}: {
  projectId: Project["id"];
  pack: Project;
  source: DataSource & { shape: "table" };
}) {
  const { t } = useTranslation();
  const addSourceRow = useAccountStore((s) => s.addSourceRow);
  const removeSourceRow = useAccountStore((s) => s.removeSourceRow);
  const fields = sourceRootFields(pack, source);
  const model = (pack.dataModels ?? []).find((candidate) => candidate.id === source.modelId);

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="source-rows-table">
      {source.rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)]">{t("dataSources.noRows")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {fields.map((f) => (
                  <th key={f.name} className="px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-faint)]">
                    {f.name}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {source.rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-soft)] align-top">
                  {fields.map((f) => (
                    <td key={f.name} className="px-2 py-1.5">
                      {f.name === model?.keyField && isRowKeyType(f.type) ? (
                        <RowKeyEditor
                          projectId={projectId}
                          sourceId={source.id}
                          row={i}
                          fieldName={f.name}
                          type={f.type.kind}
                          value={r[f.name]}
                        />
                      ) : (
                        <ValueEditor
                          projectId={projectId}
                          sourceId={source.id}
                          row={i}
                          path={[f.name]}
                          type={f.type}
                          value={r[f.name]}
                          pack={pack}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeSourceRow({ projectId, sourceId: source.id, index: i })}
                      className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
                      aria-label={t("dataSources.removeRow")}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={() => addSourceRow({ projectId, sourceId: source.id })}
        className="btn-ghost h-7 self-start rounded px-2 text-[11px]"
      >
        {t("dataSources.addRow")}
      </button>
    </div>
  );
}

/** Form of a Config source: its single value object. */
export function ConfigValueForm({
  projectId,
  pack,
  source,
}: {
  projectId: Project["id"];
  pack: Project;
  source: DataSource & { shape: "config" };
}) {
  return (
    <div data-testid="config-value-form">
      <ValueEditor
        projectId={projectId}
        sourceId={source.id}
        row={null}
        path={[]}
        type={{ kind: "object", fields: source.fields }}
        value={source.value}
        pack={pack}
      />
    </div>
  );
}
