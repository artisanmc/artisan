import { LocalizedTextField } from "@/components/LocalizedTextField";
import { RevealField } from "@/components/RevealField";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { TagInput } from "@/components/ui/tag-input";
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
import { ItemValueField } from "@/features/canvas/ItemValueField";
import { resolveRowTexts } from "@/features/canvas/menuPreviewScope";
import { ActionFieldEditor } from "@/features/data/ActionFieldEditor";
import { ConditionListEditor } from "@/features/inspector/properties/ConditionListEditor";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import { useProjectsStore } from "@/state/projectsStore";
import { Plus, X } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
    const id = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
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

/**
 * How a value form lays itself out. `compact` fits a sheet cell or a side pane;
 * `settings` is a page of its own (a module's Settings screen): one panel per
 * top-level group, each label and its help beside the control.
 */
export type FormLayout = "compact" | "settings";
const FormLayoutContext = createContext<FormLayout>("compact");

/** Control sizes of the settings layout: the inspector's, one step under the page inputs. */
const SETTINGS_INPUT = "h-8 rounded-[var(--r-xs)] px-2.5 py-0 text-[13px]";
const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-[var(--r-xs)] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]";
const ADD_BUTTON =
  "inline-flex h-7 shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-[var(--r-xs)] border border-[var(--border)] border-dashed px-2.5 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Cell kinds a map table edits in place: one short control each. */
const TABLE_CELL_KINDS = new Set<ModelFieldType["kind"]>([
  "string",
  "number",
  "integer",
  "boolean",
  "enum",
]);

/**
 * Columns of a map shown as a table on a settings page: a map whose values are
 * objects of short scalar fields (guild levels, price tiers). One row per
 * entry instead of one block of stacked rows per entry. null: not tabular.
 */
export function mapTableColumns(type: ModelFieldType, models: DataModel[]): ModelField[] | null {
  if (type.kind !== "map") return null;
  const fields = resolveObjectFields(type.of, models);
  if (!fields || fields.length === 0) return null;
  return fields.every((f) => TABLE_CELL_KINDS.has(f.type.kind)) ? fields : null;
}

/** A map key that is a level/rank number: `0`, `1`, `12` (no sign, no leading zero). */
function isIndexKey(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key);
}

/**
 * The entry the add button appends to a map keyed by numbers: the next number,
 * starting from a copy of the last entry (a new level is most often the
 * previous one, tuned). null when the keys are not all numbers — the admin
 * names the key.
 */
export function nextIndexedEntry(
  obj: Record<string, unknown>,
  of: ModelFieldType,
  models: DataModel[],
): { key: string; value: unknown } | null {
  const keys = Object.keys(obj);
  if (keys.length === 0 || !keys.every(isIndexKey)) return null;
  const last = keys.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  const previous = obj[last];
  const value =
    typeof previous === "object" && previous !== null && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : defaultValueForModelType(of, models);
  return { key: String(Number(last) + 1), value };
}

/** Key input + add button for a map entry (kind=map values). */
function MapEntryAdder({ existing, onAdd }: { existing: string[]; onAdd: (key: string) => void }) {
  const { t } = useTranslation();
  const settings = useContext(FormLayoutContext) === "settings";
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
        className={
          settings
            ? `${SETTINGS_INPUT} w-36 font-mono text-[12px]`
            : "h-6 w-28 px-2 font-mono text-[11px]"
        }
      />
      <button
        type="button"
        onClick={commit}
        className={settings ? ADD_BUTTON : "btn-ghost h-6 rounded px-2 text-[11px]"}
        aria-label={t("dataSources.addMapEntry")}
      >
        {settings ? <Plus size={13} /> : null}
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
  const setSourceValue = useProjectsStore((s) => s.setSourceValue);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState<"required" | "duplicate" | null>(null);
  const errorId = `row-key-error-${sourceId}-${row}`;

  // Reset on IDENTITY change (value/source/field), not on position: rows are
  // rendered with identity-derived React keys, so after a mid-list delete the
  // same instance keeps its row datum while its `row` index prop shifts — an
  // in-progress draft must survive that shift.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceId/fieldName are reset triggers (row identity), not values read by the effect
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
        <p id={errorId} className="text-[11px] text-[var(--danger)]">
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
  project,
  field,
}: {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number | null;
  path: (string | number)[];
  type: ModelFieldType;
  value: unknown;
  project: Project;
  /** The declaring field, when editing a named field — carries hints + validation (§7). */
  field?: ModelField;
}) {
  const { t } = useTranslation();
  const setSourceValue = useProjectsStore((s) => s.setSourceValue);
  const addSourceListItem = useProjectsStore((s) => s.addSourceListItem);
  const removeSourceListItem = useProjectsStore((s) => s.removeSourceListItem);
  const replaceSourceValueTyped = useProjectsStore((s) => s.replaceSourceValueTyped);
  const settings = useContext(FormLayoutContext) === "settings";
  const models = project.dataModels ?? [];
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
          // Capped: on a full-width Config screen an uncapped text input
          // stretches across the whole page.
          className={
            settings
              ? `${SETTINGS_INPUT} w-full max-w-sm`
              : "h-7 min-w-24 max-w-md px-2 text-[12px]"
          }
          aria-label={String(path[path.length - 1])}
          aria-invalid={patternBad || requiredBad}
        />
      );
    }
    case "number":
    case "integer": {
      const n0 = typeof value === "number" ? value : 0;
      const outOfBounds =
        (field?.min !== undefined && n0 < field.min) ||
        (field?.max !== undefined && n0 > field.max);
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
          className={settings ? `${SETTINGS_INPUT} w-36` : "h-7 w-24 px-2 text-[12px]"}
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
    case "boolean": {
      const toggle = (
        <Switch
          checked={value === true}
          onCheckedChange={set}
          aria-label={String(path[path.length - 1])}
        />
      );
      // Centred on the row's first line, like a text field's value.
      return settings ? <div className="flex h-8 items-center">{toggle}</div> : toggle;
    }
    case "item": {
      const source = project.dataSources?.find((s) => s.id === sourceId);
      const root =
        source?.shape === "table" && row !== null
          ? source.rows[row]
          : source?.shape === "config"
            ? source.value
            : {};
      const owner = path
        .slice(0, -1)
        .reduce<unknown>(
          (obj, key) =>
            obj && typeof obj === "object"
              ? (obj as Record<string | number, unknown>)[key]
              : undefined,
          root,
        );
      const current = resolveRowTexts([(owner as Record<string, unknown>) ?? {}], project)[0];
      return (
        <ItemValueField
          projectId={projectId}
          value={value}
          onChange={set}
          scope={{ item: current }}
        />
      );
    }
    case "actions":
      return <ActionFieldEditor projectId={projectId} value={value} onChange={set} />;
    case "minimessage":
    case "minimessage_multiline": {
      // MiniMessage widget kit: rendered facade at
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
          className={
            multiline
              ? "w-full min-w-48 text-[12px]"
              : settings
                ? `${SETTINGS_INPUT} w-full max-w-md`
                : "h-7 w-full min-w-24 px-2 text-[12px]"
          }
          placeholder={String(path[path.length - 1])}
          facade={<MiniMessageInline source={text} className="font-mono text-xs" />}
        />
      );
    }
    case "ltext": {
      // Sentinel ({key:""}) = not minted yet — mint runs on row/field add, so
      // this only shows transiently on non-conforming hand-imported data.
      if (!isLTextNode(value) || value.key === "")
        return <span className="text-[11px] text-[var(--text-faint)]">—</span>;
      return (
        <LocalizedTextField
          inline
          className={settings ? "w-full max-w-sm" : "w-full min-w-24"}
          projectId={projectId}
          lt={value}
          label={String(path[path.length - 1])}
          renderEditor={({ lang, value: text, fallback, label, onChange }) => (
            <Input
              value={text}
              placeholder={fallback}
              onChange={(e) => onChange(e.target.value)}
              className={settings ? `${SETTINGS_INPUT} w-full` : "h-7 w-full px-2 text-[12px]"}
              aria-label={label}
              data-lang={lang}
            />
          )}
        />
      );
    }
    case "list": {
      const items = Array.isArray(value) ? value : [];
      const itemKeys = stableKeys(items.map((el) => listItemIdentity(el, type.of, models)));
      const of = type.of;
      const testId = `list-${path.join(".")}`;
      if (settings && (of.kind === "string" || of.kind === "number" || of.kind === "integer")) {
        // A list of words (durations, currency ids, materials): tags in one field.
        return (
          <div className="w-full max-w-sm" data-testid={testId}>
            <TagInput
              values={items.map((el) => String(el ?? ""))}
              label={t("dataSources.addValue")}
              placeholder={t("dataSources.addValuePlaceholder")}
              removeLabel={(v) => t("dataSources.removeValue", { value: v })}
              onAdd={(raw) => {
                if (of.kind === "string") {
                  set([...items, raw]);
                  return true;
                }
                const n = Number(raw.replace(",", "."));
                if (!Number.isFinite(n)) return false;
                set([...items, of.kind === "integer" ? Math.round(n) : n]);
                return true;
              }}
              onRemove={(index) => removeSourceListItem({ projectId, sourceId, row, path, index })}
            />
          </div>
        );
      }
      if (settings && of.kind === "enum") {
        // A subset of a closed set: every choice shown, the picked ones lit.
        // A hand-written value outside the set stays visible so it can be removed.
        const extra = items.filter(
          (el): el is string => typeof el === "string" && !of.values.includes(el),
        );
        return (
          <div className="flex min-h-8 flex-wrap items-center gap-1.5" data-testid={testId}>
            {[...of.values, ...extra].map((v) => {
              const on = items.includes(v);
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(on ? items.filter((el) => el !== v) : [...items, v])}
                  className={cx("chip", on && "is-active")}
                >
                  {v}
                </button>
              );
            })}
          </div>
        );
      }
      if (settings) {
        return (
          <div className="flex w-full flex-col gap-2" data-testid={testId}>
            {items.map((el, i) => (
              <div
                key={itemKeys[i]}
                className="flex w-full items-start gap-2 rounded-[var(--r-sm)] border border-[var(--border-soft)] py-1 pr-1 pl-3"
              >
                <div className="min-w-0 flex-1 py-1">
                  <ValueEditor
                    projectId={projectId}
                    sourceId={sourceId}
                    row={row}
                    path={[...path, i]}
                    type={of}
                    value={el}
                    project={project}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSourceListItem({ projectId, sourceId, row, path, index: i })}
                  className={ICON_BUTTON}
                  aria-label={t("dataSources.removeItem")}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addSourceListItem({ projectId, sourceId, row, path })}
              className={ADD_BUTTON}
            >
              <Plus size={13} />
              {t("dataSources.addListItem")}
            </button>
          </div>
        );
      }
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
                  project={project}
                />
              </div>
              <button
                type="button"
                onClick={() => removeSourceListItem({ projectId, sourceId, row, path, index: i })}
                className="mt-1 rounded px-1 text-[11px] text-[var(--text-faint)] hover:text-rose-300"
                aria-label={t("dataSources.removeItem")}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addSourceListItem({ projectId, sourceId, row, path })}
            className="btn-ghost h-6 self-start rounded px-2 text-[11px]"
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
          className={
            settings
              ? `select ${SETTINGS_INPUT} w-auto min-w-36 pr-8`
              : "select h-7 w-auto rounded-[var(--r-xs)] py-0 pr-7 pl-2 text-[12px]"
          }
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
      const columns = settings ? mapTableColumns(type, models) : null;
      if (columns) {
        return (
          <MapTable
            ctx={{ projectId, sourceId, row, project }}
            path={path}
            columns={columns}
            obj={obj}
            onAdd={(k, v) => set({ ...obj, [k]: v })}
            onAddNamed={(k) => set({ ...obj, [k]: defaultValueForModelType(type.of, models) })}
            onRemove={(k) => {
              const next = { ...obj };
              delete next[k];
              replaceTyped(next);
            }}
            next={nextIndexedEntry(obj, type.of, models)}
          />
        );
      }
      if (settings) {
        return (
          <div
            className="flex w-full max-w-xl flex-col gap-2"
            data-testid={`map-${path.join(".")}`}
          >
            {entries.length > 0 ? (
              // One grid for every entry, so the keys line up in one column.
              <div className="grid grid-cols-[auto_minmax(0,24rem)_auto] items-start gap-x-3 gap-y-1.5">
                {entries.map(([k]) => (
                  <Fragment key={k}>
                    <code className="max-w-40 break-all pt-1.5 font-mono text-[12px] text-[var(--text-mut)]">
                      {k}
                    </code>
                    <div className="min-w-0">
                      <ValueEditor
                        projectId={projectId}
                        sourceId={sourceId}
                        row={row}
                        path={[...path, k]}
                        type={type.of}
                        value={obj[k]}
                        project={project}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...obj };
                        delete next[k];
                        replaceTyped(next);
                      }}
                      className={cx(ICON_BUTTON, "mt-0.5")}
                      aria-label={t("dataSources.removeMapEntry", { key: k })}
                    >
                      <X size={14} />
                    </button>
                  </Fragment>
                ))}
              </div>
            ) : null}
            <MapEntryAdder
              existing={Object.keys(obj)}
              onAdd={(k) => set({ ...obj, [k]: defaultValueForModelType(type.of, models) })}
            />
          </div>
        );
      }
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
                project={project}
              />
              <button
                type="button"
                onClick={() => {
                  const next = { ...obj };
                  delete next[k];
                  replaceTyped(next);
                }}
                className="mt-1 rounded px-1 text-[11px] text-[var(--text-faint)] hover:text-rose-300"
                aria-label={t("dataSources.removeMapEntry", { key: k })}
              >
                ✕
              </button>
            </div>
          ))}
          <MapEntryAdder
            existing={Object.keys(obj)}
            onAdd={(k) => set({ ...obj, [k]: defaultValueForModelType(type.of, models) })}
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
          className={
            settings
              ? "flex w-full flex-col gap-2"
              : "flex flex-col gap-1 rounded border border-[var(--border-soft)] p-1.5"
          }
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
            className={
              settings
                ? `select ${SETTINGS_INPUT} w-auto min-w-36 self-start pr-8 font-mono text-[12px]`
                : "select h-7 w-auto self-start rounded-[var(--r-xs)] py-0 pr-7 pl-2 font-mono text-[11px]"
            }
            aria-label={type.tag}
          >
            {type.variants.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          {active && settings ? (
            <div className="border-[var(--border-soft)] border-l-2 pl-4">
              <FieldRows
                ctx={{ projectId, sourceId, row, project }}
                fields={active.fields}
                obj={obj}
                path={path}
                captionRem={12}
              />
            </div>
          ) : active ? (
            <div className="ml-1 flex flex-col gap-1">
              {active.fields.map((f) => (
                <div key={f.name} className="flex items-start gap-1.5">
                  <span
                    className="mt-1.5 min-w-16 text-[11px] text-[var(--text-mut)]"
                    title={f.help}
                  >
                    {f.label ?? f.name}
                  </span>
                  <ValueEditor
                    projectId={projectId}
                    sourceId={sourceId}
                    row={row}
                    path={[...path, f.name]}
                    type={f.type}
                    value={obj[f.name]}
                    project={project}
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
      if (!fields) return <span className="text-[11px] text-[var(--text-faint)]">—</span>;
      const obj = asRecord(value);
      if (settings) {
        const ctx = { projectId, sourceId, row, project };
        // The root of the page splits into panels; deeper (a list item, a map
        // value) the fields are plain rows inside whatever holds them.
        return path.length === 0 ? (
          <SettingsSections ctx={ctx} fields={fields} obj={obj} />
        ) : (
          <FieldRows ctx={ctx} fields={fields} obj={obj} path={path} captionRem={12} />
        );
      }
      return (
        <div className="flex w-full flex-col gap-1 rounded border border-[var(--border-soft)] p-2">
          {fields.map((f, i) => (
            <div key={f.name} className="flex flex-col gap-1">
              {/* §7 `section` hint: header when it changes from the previous field. */}
              {f.section && f.section !== fields[i - 1]?.section ? (
                <span className="eyebrow mt-1">{f.section}</span>
              ) : null}
              <div className="flex w-full items-start gap-2">
                {/* No truncation: field names are the contract with the file on
                    disk. A label never REPLACES the key — the key is what you
                    look for over SSH (ADR yaml-assisted-editing ⑨). */}
                <span className="min-w-24 max-w-44 shrink-0 break-words">
                  {f.label ? (
                    <>
                      <span className="block text-[11px] text-[var(--text-mut)]">{f.label}</span>
                      <span className="block font-mono text-[10px] text-[var(--text-faint)]">
                        {f.name}
                      </span>
                    </>
                  ) : (
                    <span className="block font-mono text-[11px] text-[var(--text-faint)]">
                      {f.name}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <ValueEditor
                    projectId={projectId}
                    sourceId={sourceId}
                    row={row}
                    path={[...path, f.name]}
                    type={f.type}
                    value={obj[f.name]}
                    project={project}
                    field={f}
                  />
                  {/* Visible, not a tooltip: the explanation is why a config
                      file feels more helpful than a form. */}
                  {f.help ? (
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                      {f.help}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

interface FormCtx {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number | null;
  project: Project;
}

/** Width of the label column at the top level of a panel. */
const CAPTION_REM = 16;
/** A nested group's indent: its 2px rule + 1rem padding. */
const INDENT_REM = 1.125;

/**
 * Label, technical key and help of a field. The key never hides behind the
 * label: it is what the admin looks for in the file over SSH (ADR
 * yaml-assisted-editing ⑨). The help is text, not a tooltip.
 */
function FieldCaption({ field }: { field: ModelField }) {
  return (
    <div className="min-w-0 pt-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {field.label ? (
          <span className="font-medium text-[13px] text-[var(--text)]">{field.label}</span>
        ) : null}
        <code
          className={cx(
            "break-all font-mono",
            field.label
              ? "text-[11px] text-[var(--text-faint)]"
              : "text-[12.5px] text-[var(--text)]",
          )}
        >
          {field.name}
        </code>
      </div>
      {field.help ? (
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)] leading-snug">{field.help}</p>
      ) : null}
    </div>
  );
}

/**
 * A tabular map on a settings page: one row per entry, its key first, one
 * column per field. The cells use the compact controls; the column header
 * shows the label and the field's key (ADR yaml-assisted-editing ⑨), the help
 * on hover.
 */
function MapTable({
  ctx,
  path,
  columns,
  obj,
  next,
  onAdd,
  onAddNamed,
  onRemove,
}: {
  ctx: FormCtx;
  path: (string | number)[];
  columns: ModelField[];
  obj: Record<string, unknown>;
  next: { key: string; value: unknown } | null;
  onAdd: (key: string, value: unknown) => void;
  onAddNamed: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const keys = Object.keys(obj);
  return (
    <div className="flex w-full flex-col gap-2" data-testid={`map-table-${path.join(".")}`}>
      {keys.length > 0 ? (
        <Table className="w-auto min-w-full">
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-px whitespace-nowrap">
                {next ? "#" : t("dataSources.mapKeyColumn")}
              </TH>
              {columns.map((c) => (
                <TH key={c.name} title={c.help} className="whitespace-nowrap normal-case">
                  <span className="block">{c.label ?? c.name}</span>
                  {c.label ? (
                    <code className="block font-mono text-[10.5px] text-[var(--text-faint)] tracking-normal">
                      {c.name}
                    </code>
                  ) : null}
                </TH>
              ))}
              <TH className="w-px">
                <span className="sr-only">{t("dataSources.removeItem")}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            <FormLayoutContext.Provider value="compact">
              {keys.map((k) => {
                const entry = asRecord(obj[k]);
                return (
                  <TR key={k} data-testid={`map-row-${[...path, k].join(".")}`}>
                    <TD className="py-1.5">
                      <code className="font-mono text-[12px] text-[var(--text-mut)]">{k}</code>
                    </TD>
                    {columns.map((c) => (
                      <TD key={c.name} className="py-1.5">
                        <ValueEditor
                          projectId={ctx.projectId}
                          sourceId={ctx.sourceId}
                          row={ctx.row}
                          path={[...path, k, c.name]}
                          type={c.type}
                          value={entry[c.name]}
                          project={ctx.project}
                          field={c}
                        />
                      </TD>
                    ))}
                    <TD className="py-1.5 pr-1.5">
                      <button
                        type="button"
                        onClick={() => onRemove(k)}
                        className={ICON_BUTTON}
                        aria-label={t("dataSources.removeMapEntry", { key: k })}
                      >
                        <X size={14} />
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </FormLayoutContext.Provider>
          </TBody>
        </Table>
      ) : null}
      {/* The help is text, not only a tooltip (ADR yaml-assisted-editing ⑨). */}
      {columns.some((c) => c.help) ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
          {columns
            .filter((c) => c.help)
            .map((c) => (
              <Fragment key={c.name}>
                <dt className="text-[var(--text-mut)]">{c.label ?? c.name}</dt>
                <dd className="text-[var(--text-faint)]">{c.help}</dd>
              </Fragment>
            ))}
        </dl>
      ) : null}
      {next ? (
        <button type="button" onClick={() => onAdd(next.key, next.value)} className={ADD_BUTTON}>
          <Plus size={13} />
          {t("dataSources.addMapRow", { key: next.key })}
        </button>
      ) : (
        <MapEntryAdder existing={keys} onAdd={onAddNamed} />
      )}
    </div>
  );
}

/**
 * The fields of an object as settings rows: label column beside the control
 * once there is room, stacked when the pane is narrow. A nested object opens an
 * indented group whose label column shrinks by the indent, so every control of
 * a panel starts on the same line.
 */
function FieldRows({
  ctx,
  fields,
  obj,
  path,
  captionRem,
  divided = false,
}: {
  ctx: FormCtx;
  fields: ModelField[];
  obj: Record<string, unknown>;
  path: (string | number)[];
  captionRem: number;
  divided?: boolean;
}) {
  const models = ctx.project.dataModels ?? [];
  return (
    <div
      className={cx("@container flex flex-col", divided && "divide-y divide-[var(--border-soft)]")}
    >
      {fields.map((f, i) => {
        const nested = f.locked ? null : resolveObjectFields(f.type, models);
        const pad = divided ? "py-3" : "py-1.5";
        return (
          <div key={f.name} className={pad}>
            {/* §7 `section` hint: header when it changes from the previous field. */}
            {f.section && f.section !== fields[i - 1]?.section ? (
              <div className="eyebrow pb-2">{f.section}</div>
            ) : null}
            {nested ? (
              <>
                <FieldCaption field={f} />
                <div className="mt-1.5 border-[var(--border-soft)] border-l-2 pl-4">
                  <FieldRows
                    ctx={ctx}
                    fields={nested}
                    obj={asRecord(obj[f.name])}
                    path={[...path, f.name]}
                    captionRem={Math.max(8, captionRem - INDENT_REM)}
                  />
                </div>
              </>
            ) : (
              <div
                className="grid gap-x-8 gap-y-1.5 @xl:grid-cols-[var(--caption-w)_minmax(0,1fr)]"
                style={{ "--caption-w": `${captionRem}rem` } as CSSProperties}
              >
                <FieldCaption field={f} />
                <div className="min-w-0">
                  <ValueEditor
                    projectId={ctx.projectId}
                    sourceId={ctx.sourceId}
                    row={ctx.row}
                    path={[...path, f.name]}
                    type={f.type}
                    value={obj[f.name]}
                    project={ctx.project}
                    field={f}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Root of a settings page: each top-level group (an object field) is a panel
 * titled by its label; top-level loose values share a panel without a title.
 */
function SettingsSections({
  ctx,
  fields,
  obj,
}: {
  ctx: FormCtx;
  fields: ModelField[];
  obj: Record<string, unknown>;
}) {
  const models = ctx.project.dataModels ?? [];
  const groups: (
    | { field: ModelField; nested: ModelField[] }
    | { field: ModelField; table: true }
    | { loose: ModelField[] }
  )[] = [];
  for (const f of fields) {
    const nested = f.locked ? null : resolveObjectFields(f.type, models);
    const last = groups[groups.length - 1];
    if (nested) groups.push({ field: f, nested });
    // A table needs the panel's width, not the control column beside a caption.
    else if (!f.locked && mapTableColumns(f.type, models)) groups.push({ field: f, table: true });
    else if (last && "loose" in last) last.loose.push(f);
    else groups.push({ loose: [f] });
  }
  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      {groups.map((g) =>
        "loose" in g ? (
          <section
            key={`loose:${g.loose[0]?.name}`}
            className="panel rounded-[var(--r-md)] px-5 py-1"
          >
            <FieldRows
              ctx={ctx}
              fields={g.loose}
              obj={obj}
              path={[]}
              captionRem={CAPTION_REM}
              divided
            />
          </section>
        ) : (
          <section
            key={g.field.name}
            className="panel rounded-[var(--r-md)] px-5 pt-4 pb-1"
            data-testid={`settings-section-${g.field.name}`}
          >
            <header className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="font-bold font-display text-[14px] text-[var(--text)]">
                {g.field.label ?? g.field.name}
              </h2>
              {g.field.label ? (
                <code className="font-mono text-[11px] text-[var(--text-faint)]">
                  {g.field.name}
                </code>
              ) : null}
            </header>
            {g.field.help ? (
              <p className="mt-0.5 text-[12px] text-[var(--text-faint)] leading-snug">
                {g.field.help}
              </p>
            ) : null}
            {"table" in g ? (
              <div className="mt-3 pb-4">
                <ValueEditor
                  projectId={ctx.projectId}
                  sourceId={ctx.sourceId}
                  row={ctx.row}
                  path={[g.field.name]}
                  type={g.field.type}
                  value={obj[g.field.name]}
                  project={ctx.project}
                  field={g.field}
                />
              </div>
            ) : (
              <div className="mt-1">
                <FieldRows
                  ctx={ctx}
                  fields={g.nested}
                  obj={asRecord(obj[g.field.name])}
                  path={[g.field.name]}
                  captionRem={CAPTION_REM}
                  divided
                />
              </div>
            )}
          </section>
        ),
      )}
    </div>
  );
}

/**
 * Rows of a Table source as a scrollable sheet: one column per top-level
 * field, min-width per column so fields never squeeze — wide models scroll
 * horizontally (spreadsheet-style). Header row, first column and the row
 * actions column stay sticky.
 */
export function SourceRowsTable({
  projectId,
  project,
  source,
}: {
  projectId: Project["id"];
  project: Project;
  source: DataSource & { shape: "table" };
}) {
  const { t } = useTranslation();
  const addSourceRow = useProjectsStore((s) => s.addSourceRow);
  const removeSourceRow = useProjectsStore((s) => s.removeSourceRow);
  const fields = sourceRootFields(project, source);
  const model = (project.dataModels ?? []).find((candidate) => candidate.id === source.modelId);
  const rowKeys = stableKeys(source.rows.map((row) => row[model?.keyField ?? "id"]));

  // §7 master-detail hint: row list beside the selected row's form (the
  // boutique catalog pattern) instead of the spreadsheet.
  if (model?.masterDetail) {
    return (
      <MasterDetailTable
        projectId={projectId}
        project={project}
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
                      "sticky top-0 z-10 whitespace-nowrap bg-[var(--surface-raised)] px-2 py-1 font-mono text-[11px] uppercase text-[var(--text-faint)]",
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
                          project={project}
                          field={f}
                        />
                      )}
                    </td>
                  ))}
                  <td className="sticky right-0 z-[5] bg-[var(--surface-raised)] px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeSourceRow({ projectId, sourceId: source.id, index: i })}
                      className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
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
  project,
  source,
  fields,
  keyField,
  rowKeys,
}: {
  projectId: Project["id"];
  project: Project;
  source: DataSource & { shape: "table" };
  fields: ModelField[];
  keyField: string;
  rowKeys: string[];
}) {
  const { t } = useTranslation();
  const addSourceRow = useProjectsStore((s) => s.addSourceRow);
  const removeSourceRow = useProjectsStore((s) => s.removeSourceRow);
  const [selectedKey, setSelectedKey] = useState<string | null>(rowKeys[0] ?? null);
  // Selection is by Row key (identity, not position — a row must never inherit
  // its neighbour's form state). But editing the key field IS a rename: the
  // identity moved while the row stayed put, so the selection follows the
  // position it was last seen at instead of collapsing to "no row".
  const lastIndex = useRef(0);
  let selected = selectedKey !== null ? rowKeys.indexOf(selectedKey) : -1;
  if (selected < 0 && selectedKey !== null && lastIndex.current < rowKeys.length) {
    selected = lastIndex.current;
  }
  useEffect(() => {
    if (selected < 0) return;
    lastIndex.current = selected;
    const key = rowKeys[selected];
    if (key !== undefined && key !== selectedKey) setSelectedKey(key);
  }, [selected, rowKeys, selectedKey]);
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
              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
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
            project={project}
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
  project,
  source,
  layout = "settings",
}: {
  projectId: Project["id"];
  project: Project;
  source: DataSource & { shape: "config" };
  /** `compact` inside a side pane that already frames the form. */
  layout?: FormLayout;
}) {
  // A bare file with no schema beside it (ADR bare-data-files: untyped =
  // literal values, never an error) still gets a form, inferred from what is
  // stored. Display only — `source.fields` stays empty, so the writer keeps
  // emitting a values-only file and never invents a schema on disk.
  const fields = source.fields.length > 0 ? source.fields : literalFields(source.value);

  return (
    <div data-testid="config-value-form">
      <FormLayoutContext.Provider value={layout}>
        <ValueEditor
          projectId={projectId}
          sourceId={source.id}
          row={null}
          path={[]}
          type={{ kind: "object", fields }}
          value={source.value}
          project={project}
        />
      </FormLayoutContext.Provider>
    </div>
  );
}

/** Fields inferred from stored values, for a source whose schema is absent. */
function literalFields(value: Record<string, unknown>): ModelField[] {
  return Object.entries(value ?? {}).map(([name, v]) => ({
    name,
    type: literalType(v),
  }));
}

function literalType(v: unknown): ModelFieldType {
  if (typeof v === "number") return { kind: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "boolean") return { kind: "boolean" };
  if (Array.isArray(v)) return { kind: "list", of: literalType(v[0]) };
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // Entries keyed by number holding objects (levels, tiers): a map, so the
    // form can add and remove entries — the fields are the union of the entries'.
    const values = Object.values(obj);
    if (
      values.length > 0 &&
      Object.keys(obj).every(isIndexKey) &&
      values.every((e) => e !== null && typeof e === "object" && !Array.isArray(e))
    ) {
      const fields = new Map<string, ModelField>();
      for (const e of values)
        for (const f of literalFields(e as Record<string, unknown>))
          if (!fields.has(f.name)) fields.set(f.name, f);
      return { kind: "map", of: { kind: "object", fields: [...fields.values()] } };
    }
    return { kind: "object", fields: literalFields(obj) };
  }
  return { kind: "string" };
}
