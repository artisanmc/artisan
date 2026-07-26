import { RevealField } from "@/components/RevealField";
import { Input } from "@/components/ui/input";
import { defaultValueForModelType, sourceRootFields } from "@/domain/dataModels";
import type {
  Condition,
  DataModel,
  DataModelId,
  DataSource,
  LText,
  ModelField,
  ModelFieldType,
  Project,
} from "@/domain/types";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
import { MaterialRefField } from "@/features/canvas/MaterialRefField";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
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
): ModelField[] | null {
  if (type.kind === "object") return type.fields;
  if (type.kind === "model") {
    if (visited.has(type.ref)) return null;
    const m = models.find((x) => x.id === type.ref);
    if (!m) return null;
    return m.fields;
  }
  return null;
}

/**
 * Stable React keys for row/list rendering: identity-derived (the row's key
 * value, an item's `id`-ish field), deduped with `#n`, falling back to the
 * position for empty identities. Index keys made React reuse stateful child
 * instances (RowKeyEditor drafts, minimessage facades) for a DIFFERENT datum
 * after a mid-list delete — the "items mixed across categories" model-ref bug.
 */
function stableKeys(identities: unknown[]): string[] {
  const seen = new Map<string, number>();
  return identities.map((raw, i) => {
    const id =
      typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    if (id === "") return `@${i}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}#${n}`;
  });
}

/** Identity of a list element: its resolved model's key field, else `id`. */
function listItemIdentity(el: unknown, of: ModelFieldType, models: DataModel[]): unknown {
  if (typeof el !== "object" || el === null || Array.isArray(el)) return undefined;
  const obj = el as Record<string, unknown>;
  if (of.kind === "model") {
    const m = models.find((x) => x.id === of.ref);
    if (m) return obj[m.keyField];
  }
  return obj.id;
}

/** Regex test that never throws on an invalid declared pattern. */
function safeRegexTest(pattern: string, s: string): boolean {
  try {
    return new RegExp(pattern).test(s);
  } catch {
    return true; // broken declaration — don't punish the value
  }
}

/** Key input + add button for a map entry (kind=map values). */
function MapEntryAdder({ existing, onAdd }: { existing: string[]; onAdd: (key: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const commit = () => {
    const k = draft.trim();
    if (k === "" || existing.includes(k)) return;
    onAdd(k);
    setDraft("");
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder={t("dataSources.mapKeyPlaceholder")}
        className="h-6 w-28 px-2 font-mono text-[11px]"
      />
      <button
        type="button"
        onClick={commit}
        className="btn-ghost h-6 rounded px-2 text-[10px]"
        aria-label={t("dataSources.addMapEntry")}
      >
        {t("dataSources.addMapEntry")}
      </button>
    </div>
  );
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

  // Reset on IDENTITY change (value/source/field), not on position: rows are
  // rendered with identity-derived React keys, so after a mid-list delete the
  // same instance keeps its row datum while its `row` index prop shifts — an
  // in-progress draft must survive that shift.
  useEffect(() => {
    setDraft(String(value ?? ""));
    setError(null);
  }, [value, sourceId, fieldName]);

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
        className={
          type === "string" ? "h-7 min-w-24 px-2 text-[12px]" : "h-7 w-24 px-2 text-[12px]"
        }
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

function isRowKeyType(
  type: ModelFieldType,
): type is Extract<ModelFieldType, { kind: "string" | "number" | "integer" }> {
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
  field,
}: {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number | null;
  path: (string | number)[];
  type: ModelFieldType;
  value: unknown;
  pack: Project;
  /** The declaring field, when editing a named field — carries hints + validation (§7). */
  field?: ModelField;
}) {
  const { t } = useTranslation();
  const setSourceValue = useAccountStore((s) => s.setSourceValue);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const addSourceListItem = useAccountStore((s) => s.addSourceListItem);
  const removeSourceListItem = useAccountStore((s) => s.removeSourceListItem);
  const replaceSourceValueTyped = useAccountStore((s) => s.replaceSourceValueTyped);
  const activeLang = useUiStore((s) => s.activeLang);
  const models = pack.dataModels ?? [];
  const set = (v: unknown) => setSourceValue({ projectId, sourceId, row, path, value: v });
  const replaceTyped = (v: unknown) =>
    replaceSourceValueTyped({ projectId, sourceId, row, path, value: v });

  // §7 `locked`: the Add-on manages this value itself — truly read-only in the
  // form (hand edits stay possible on disk and are surfaced, never reverted).
  if (field?.locked) {
    return (
      <code
        className="rounded bg-[var(--surface-raised-2)] px-2 py-1 text-[11px] text-[var(--text-mut)]"
        title={t("dataSources.lockedHint")}
        data-testid={`locked-${path.join(".")}`}
      >
        {typeof value === "string" || typeof value === "number" ? String(value) : "…"}
      </code>
    );
  }

  switch (type.kind) {
    case "string": {
      const s = typeof value === "string" ? value : "";
      // §7 asymmetric validation: signaled live (aria-invalid), never blocking
      // a value that already exists on disk.
      const patternBad = field?.pattern ? !safeRegexTest(field.pattern, s) : false;
      const requiredBad = field?.required === true && s.trim() === "";
      return (
        <Input
          value={s}
          onChange={(e) => set(e.target.value)}
          className="h-7 min-w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
          aria-invalid={patternBad || requiredBad}
        />
      );
    }
    case "number":
    case "integer": {
      const n0 = typeof value === "number" ? value : 0;
      const outOfBounds =
        (field?.min !== undefined && n0 < field.min) || (field?.max !== undefined && n0 > field.max);
      return (
        <Input
          type="number"
          value={n0}
          min={field?.min}
          max={field?.max}
          onChange={(e) => {
            let n = Number(e.target.value);
            if (!Number.isFinite(n)) n = 0;
            if (type.kind === "integer") n = Math.round(n);
            // §7 min/max: blocking by construction — the form clamps at commit.
            if (field?.min !== undefined && n < field.min) n = field.min;
            if (field?.max !== undefined && n > field.max) n = field.max;
            set(n);
          }}
          className="h-7 w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
          aria-invalid={outOfBounds}
        />
      );
    }
    case "conditions":
      // Core condition vocabulary (§6) — the appearance `if` editor, reused.
      return (
        <div className="min-w-64" data-testid={`conditions-${path.join(".")}`}>
          <ConditionListEditor
            label={field?.label ?? String(path[path.length - 1])}
            conditions={Array.isArray(value) ? (value as Condition[]) : []}
            onChange={(next) => set(next)}
          />
        </div>
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
    case "actions":
      return (
        <ActionFieldEditor
          projectId={projectId}
          value={typeof value === "string" ? value : ""}
          onChange={set}
        />
      );
    case "minimessage":
    case "minimessage_multiline": {
      // Same kit as the SchemaForm minimessage widgets: rendered facade at
      // rest, raw markup in a PlaceholderInput on focus. Plain string value.
      const multiline = type.kind === "minimessage_multiline";
      const text = typeof value === "string" ? value : "";
      return (
        <RevealField
          value={text}
          onChange={set}
          entries={[]}
          multiline={multiline}
          rows={multiline ? 3 : undefined}
          className={multiline ? "w-full min-w-48 text-[12px]" : "h-7 w-full min-w-24 px-2 text-[12px]"}
          placeholder={String(path[path.length - 1])}
          facade={<MiniMessageInline source={text} className="font-mono text-xs" />}
        />
      );
    }
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
          className="h-7 w-full min-w-24 px-2 text-[12px]"
          aria-label={String(path[path.length - 1])}
          data-lang={activeLang}
        />
      );
    }
    case "list": {
      const items = Array.isArray(value) ? value : [];
      const itemKeys = stableKeys(items.map((el) => listItemIdentity(el, type.of, models)));
      return (
        <div className="flex w-full flex-col gap-1" data-testid={`list-${path.join(".")}`}>
          {items.map((el, i) => (
            <div key={itemKeys[i]} className="flex w-full items-start gap-1">
              <div className="min-w-0 flex-1">
                <ValueEditor
                  projectId={projectId}
                  sourceId={sourceId}
                  row={row}
                  path={[...path, i]}
                  type={type.of}
                  value={el}
                  pack={pack}
                />
              </div>
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
    case "enum":
      return (
        <select
          value={typeof value === "string" ? value : (type.values[0] ?? "")}
          onChange={(e) => set(e.target.value)}
          className="input h-7 w-auto px-1 text-[12px]"
          aria-label={String(path[path.length - 1])}
        >
          {type.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case "map": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const entries = Object.entries(obj);
      return (
        <div className="flex flex-col gap-1" data-testid={`map-${path.join(".")}`}>
          {entries.map(([k]) => (
            <div key={k} className="flex items-start gap-1.5">
              <code className="mt-1.5 min-w-16 text-[11px] text-[var(--text-mut)]">{k}</code>
              <ValueEditor
                projectId={projectId}
                sourceId={sourceId}
                row={row}
                path={[...path, k]}
                type={type.of}
                value={obj[k]}
                pack={pack}
              />
              <button
                type="button"
                onClick={() => {
                  const next = { ...obj };
                  delete next[k];
                  replaceTyped(next);
                }}
                className="mt-1 rounded px-1 text-[10px] text-[var(--text-faint)] hover:text-rose-300"
                aria-label={t("dataSources.removeMapEntry", { key: k })}
              >
                ✕
              </button>
            </div>
          ))}
          <MapEntryAdder
            existing={Object.keys(obj)}
            onAdd={(k) =>
              set({ ...obj, [k]: defaultValueForModelType(type.of, models) })
            }
          />
        </div>
      );
    }
    case "union": {
      const obj =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const active = type.variants.find((v) => v.name === obj[type.tag]) ?? type.variants[0];
      return (
        <div
          className="flex flex-col gap-1 rounded border border-[var(--border-soft)] p-1.5"
          data-testid={`union-${path.join(".")}`}
        >
          <select
            value={active?.name ?? ""}
            onChange={(e) => {
              const variant = type.variants.find((v) => v.name === e.target.value);
              if (!variant || variant.name === active?.name) return;
              // Switching variants rebuilds the value from the new variant's
              // defaults — the old variant's ltext keys are released (typed).
              const fresh: Record<string, unknown> = { [type.tag]: variant.name };
              for (const f of variant.fields)
                fresh[f.name] = defaultValueForModelType(f.type, models);
              replaceTyped(fresh);
            }}
            className="input h-7 w-auto self-start px-1 font-mono text-[11px]"
            aria-label={type.tag}
          >
            {type.variants.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          {active ? (
            <div className="ml-1 flex flex-col gap-1">
              {active.fields.map((f) => (
                <div key={f.name} className="flex items-start gap-1.5">
                  <span className="mt-1.5 min-w-16 text-[11px] text-[var(--text-mut)]" title={f.help}>
                    {f.label ?? f.name}
                  </span>
                  <ValueEditor
                    projectId={projectId}
                    sourceId={sourceId}
                    row={row}
                    path={[...path, f.name]}
                    type={f.type}
                    value={obj[f.name]}
                    pack={pack}
                    field={f}
                  />
                </div>
              ))}
            </div>
          ) : null}
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
        <div className="flex w-full flex-col gap-1 rounded border border-[var(--border-soft)] p-2">
          {fields.map((f, i) => (
            <div key={f.name} className="flex flex-col gap-1">
              {/* §7 `section` hint: header when it changes from the previous field. */}
              {f.section && f.section !== fields[i - 1]?.section ? (
                <span className="eyebrow mt-1">{f.section}</span>
              ) : null}
              <div className="flex w-full items-center gap-2">
                <span
                  className="w-24 shrink-0 truncate font-mono text-[10px] text-[var(--text-faint)]"
                  title={f.help}
                >
                  {f.label ?? f.name}
                </span>
                <div className="min-w-0 flex-1">
                  <ValueEditor
                    projectId={projectId}
                    sourceId={sourceId}
                    row={row}
                    path={[...path, f.name]}
                    type={f.type}
                    value={obj[f.name]}
                    pack={pack}
                    field={f}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

/**
 * Rows of a Table source as a scrollable sheet: one column per top-level
 * field, min-width per column so fields never squeeze — wide models scroll
 * horizontally (spreadsheet-style). Header row, first column and the row
 * actions column stay sticky.
 */
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
  const rowKeys = stableKeys(source.rows.map((row) => row[model?.keyField ?? "id"]));

  // §7 master-detail hint: row list beside the selected row's form (the
  // boutique catalog pattern) instead of the spreadsheet.
  if (model?.masterDetail) {
    return (
      <MasterDetailTable
        projectId={projectId}
        pack={pack}
        source={source}
        fields={fields}
        keyField={model.keyField}
        rowKeys={rowKeys}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="source-rows-table">
      {source.rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)]">{t("dataSources.noRows")}</p>
      ) : (
        <div
          className="max-h-[26rem] overflow-auto rounded border border-[var(--border-soft)]"
          data-testid="source-rows-sheet"
        >
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr>
                {fields.map((f, i) => (
                  <th
                    key={f.name}
                    title={f.help}
                    className={cx(
                      "sticky top-0 z-10 whitespace-nowrap bg-[var(--surface-raised)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-faint)]",
                      i === 0 && "left-0 z-20",
                    )}
                  >
                    {f.label ?? f.name}
                  </th>
                ))}
                <th className="sticky top-0 right-0 z-20 w-8 bg-[var(--surface-raised)]" />
              </tr>
            </thead>
            <tbody>
              {source.rows.map((r, i) => (
                <tr key={rowKeys[i]} className="border-t border-[var(--border-soft)] align-top">
                  {fields.map((f, fi) => (
                    <td
                      key={f.name}
                      className={cx(
                        "min-w-36 px-2 py-1.5",
                        fi === 0 && "sticky left-0 z-[5] bg-[var(--surface-raised)]",
                      )}
                    >
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
                          field={f}
                        />
                      )}
                    </td>
                  ))}
                  <td className="sticky right-0 z-[5] bg-[var(--surface-raised)] px-1 py-1.5">
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
        className="btn-ghost h-7 shrink-0 self-start whitespace-nowrap rounded px-2 text-[11px]"
      >
        {t("dataSources.addRow")}
      </button>
    </div>
  );
}

/**
 * §7 master-detail presentation of a Table: the row list (master, Row key
 * labels) beside the selected row's full form (detail). Same store actions as
 * the spreadsheet — presentation only.
 */
function MasterDetailTable({
  projectId,
  pack,
  source,
  fields,
  keyField,
  rowKeys,
}: {
  projectId: Project["id"];
  pack: Project;
  source: DataSource & { shape: "table" };
  fields: ModelField[];
  keyField: string;
  rowKeys: string[];
}) {
  const { t } = useTranslation();
  const addSourceRow = useAccountStore((s) => s.addSourceRow);
  const removeSourceRow = useAccountStore((s) => s.removeSourceRow);
  const [selectedKey, setSelectedKey] = useState<string | null>(rowKeys[0] ?? null);
  const selected = selectedKey !== null ? rowKeys.indexOf(selectedKey) : -1;
  const row = selected >= 0 ? source.rows[selected] : undefined;

  return (
    <div className="flex min-h-0 gap-3" data-testid="source-master-detail">
      <div className="flex w-44 shrink-0 flex-col gap-1">
        <ul className="flex max-h-[26rem] flex-col gap-0.5 overflow-y-auto">
          {source.rows.map((r, i) => (
            <li key={rowKeys[i]}>
              <button
                type="button"
                onClick={() => setSelectedKey(rowKeys[i] ?? null)}
                className={cx(
                  "w-full truncate rounded px-2 py-1 text-left text-[12px]",
                  i === selected
                    ? "bg-[var(--surface-raised-2)] text-[var(--text)]"
                    : "text-[var(--text-mut)] hover:bg-[var(--surface-raised)]",
                )}
                aria-current={i === selected}
              >
                {String(r[keyField] ?? `#${i + 1}`)}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => addSourceRow({ projectId, sourceId: source.id })}
          className="btn-ghost h-7 self-start whitespace-nowrap rounded px-2 text-[11px]"
        >
          {t("dataSources.addRow")}
        </button>
      </div>
      {row !== undefined && selected >= 0 ? (
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                removeSourceRow({ projectId, sourceId: source.id, index: selected });
                setSelectedKey(null);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
              aria-label={t("dataSources.removeRow")}
            >
              ✕ {t("dataSources.removeRow")}
            </button>
          </div>
          <ValueEditor
            projectId={projectId}
            sourceId={source.id}
            row={selected}
            path={[]}
            type={{ kind: "object", fields }}
            value={row}
            pack={pack}
          />
        </div>
      ) : (
        <p className="text-[11px] text-[var(--text-faint)]">{t("dataSources.noRows")}</p>
      )}
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
