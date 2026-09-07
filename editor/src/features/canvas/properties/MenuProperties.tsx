import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
  ContextInput,
  InventoryType,
  Menu,
  MenuId,
  Project,
  ProjectId,
  SourceRef,
} from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { LayersPanel } from "@/features/canvas/title/composer/LayersPanel";
import { MenuSetBlock, ObjectParamLists } from "./MenuDataSection";
import { PreviewContextSection } from "./PreviewContextSection";
import { SourceShapingEditor } from "./SourceShapingEditor";
import { sourceFieldType } from "@/domain/dataModels";
import { summarizeFieldType } from "@/features/data/helpers";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useProjectLibraryStore } from "@/features/project/projectLibraryStore";
import { Library as LibraryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PropertyField } from "./PropertyField";

interface MenuPropertiesProps {
  projectId: ProjectId;
  menu: Menu;
}

const ROWS_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const INVENTORY_TYPE_OPTIONS: InventoryType[] = ["chest", "hopper", "dropper"];
const PRIMITIVE_TYPES: Extract<ContextInput, { kind: "primitive" }>["type"][] = [
  "player",
  "string",
  "integer",
  "number",
  "boolean",
];

/** "boutique:categories" → "Category" — display-only desingularized model name. */
export function rowModelLabel(ref: string): string {
  const tail = ref.slice(ref.indexOf(":") + 1) || ref;
  const singular = tail.endsWith("ies")
    ? `${tail.slice(0, -3)}y`
    : tail.endsWith("s")
      ? tail.slice(0, -1)
      : tail;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export function MenuProperties({ projectId, menu }: MenuPropertiesProps) {
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const { t } = useTranslation();

  const elementCount = menu.layers.reduce((sum, layer) => sum + layer.elements.length, 0);

  const type = menu.inventoryType ?? "chest";
  const capacity = slotCount(type, menu.rows);
  const outOfRange = menu.layers.reduce(
    (n, l) =>
      n + l.elements.filter((el) => parsePositions(el.positions).some((p) => p >= capacity)).length,
    0,
  );
  const onTypeChange = (next: InventoryType) =>
    setMenuField({ projectId, menuId: menu.id, field: "inventoryType", value: next });

  const onRowsChange = (rows: 1 | 2 | 3 | 4 | 5 | 6) => {
    try {
      setMenuField({ projectId, menuId: menu.id, field: "rows", value: rows });
      setRowsError(null);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : t("menuProperties.rowsChangeRejected"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {elementCount === 0 ? (
        <div className="flex flex-col gap-2 rounded border border-[var(--brand-line)] border-dashed bg-[var(--brand-soft)] p-3">
          <div className="font-mono text-[10px] text-[var(--brand)] uppercase tracking-wide">
            {t("menuProperties.emptyMenuTitle")}
          </div>
          <p className="text-[11px] text-[var(--text-mut)]">{t("menuProperties.emptyMenuHint")}</p>
          <button
            type="button"
            onClick={() => useProjectLibraryStore.getState().open(projectId, "items")}
            className="self-start inline-flex items-center gap-1 rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)] hover:bg-[var(--brand)]/20"
          >
            <LibraryIcon className="h-3 w-3" />
            {t("menuProperties.openLibrary")}
          </button>
        </div>
      ) : null}
      <MenuIdField projectId={projectId} menuId={menu.id} />
      <div className="flex flex-col gap-1.5" data-testid="menu-properties-title-section">
        <div className="font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
          {t("menuProperties.titleSection")}
        </div>
        <LayersPanel projectId={projectId} menuId={menu.id} />
      </div>
      <PropertyField
        label={t("menuProperties.permission")}
        value={menu.permission ?? ""}
        placeholder={t("menuProperties.permissionPlaceholder")}
        onChange={(v) => setMenuField({ projectId, menuId: menu.id, field: "permission", value: v })}
      />
      <div>
        <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
          {t("menuProperties.inventoryType")}
        </div>
        <div className="flex gap-1">
          {INVENTORY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onTypeChange(opt)}
              className={
                opt === type
                  ? "rounded border border-[var(--brand)] bg-[var(--brand-soft)] px-2 py-1 text-xs"
                  : "rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--border-strong)]"
              }
            >
              {t(`menuProperties.type${opt[0]!.toUpperCase()}${opt.slice(1)}`)}
            </button>
          ))}
        </div>
        {outOfRange > 0 ? (
          <div className="mt-1.5 rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1 text-[10px] text-[var(--warning)]">
            {t("menuProperties.outOfRange", { count: outOfRange })}
          </div>
        ) : null}
      </div>
      {type === "chest" ? (
        <div>
          <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
            {t("menuProperties.rows")}
          </div>
          <div className="flex gap-1">
            {ROWS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRowsChange(r)}
                className={
                  r === menu.rows
                    ? "rounded border border-[var(--brand)] bg-[var(--brand-soft)] px-2 py-1 text-xs"
                    : "rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--border-strong)]"
                }
              >
                {r}
              </button>
            ))}
          </div>
          {rowsError && <div className="mt-1 text-[10px] text-[var(--danger)]">{rowsError}</div>}
        </div>
      ) : null}
      <ContextInputsEditor projectId={projectId} menu={menu} />
    </div>
  );
}

function MenuIdField({ projectId, menuId }: { projectId: ProjectId; menuId: MenuId }) {
  const setMenuId = useAccountStore((s) => s.setMenuId);
  const [draft, setDraft] = useState<string>(menuId);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    setDraft(menuId);
    setError(null);
  }, [menuId]);

  const commit = () => {
    if (draft === menuId) {
      setError(null);
      return;
    }
    try {
      setMenuId({ projectId, oldId: menuId, newId: draft as MenuId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(menuId);
    }
  };

  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
        {t("menuProperties.id")}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(menuId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
      <div className="mt-1 text-[10px] text-[var(--text-faint)]">
        {t("menuProperties.idHint", { tag: "open_menu" })}
      </div>
    </div>
  );
}

function ContextInputsEditor({ projectId, menu }: { projectId: ProjectId; menu: Menu }) {
  const addInput = useAccountStore((s) => s.addMenuContextInput);
  const setInput = useAccountStore((s) => s.setMenuContextInput);
  const removeInput = useAccountStore((s) => s.removeMenuContextInput);
  const inputs = menu.contextInputs ?? [];
  const { t } = useTranslation();

  // dup/empty validation, same pattern as command args
  const dups = new Set<string>();
  const seen = new Set<string>();
  for (const i of inputs) {
    if (i.name === "") continue;
    if (seen.has(i.name)) dups.add(i.name);
    seen.add(i.name);
  }

  const update = (index: number, patch: Partial<ContextInput>) => {
    const current = inputs[index];
    if (!current) return;
    setInput({ projectId, menuId: menu.id, index, input: { ...current, ...patch } as ContextInput });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
        {t("menuProperties.dataSection")}
      </div>
      <p className="text-[10px] text-[var(--text-faint)]">
        {t("menuProperties.contextInputsHint", { tag: "{name}" })}
      </p>
      <PreviewContextSection menu={menu} projectId={projectId} />
      {inputs.length === 0 ? (
        <div className="rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
          {t("menuProperties.contextInputsEmpty")}
        </div>
      ) : (
        inputs.map((input, i) => {
          const isInvalid = input.name === "" || dups.has(input.name);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: index stable per render
              key={i}
              className={
                isInvalid
                  ? "flex flex-col gap-1 rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-1.5"
                  : "flex flex-col gap-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5"
              }
            >
              {input.kind === "primitive" ? (
                <>
                  <PrimitiveInputRow
                    input={input}
                    onChange={(patch) => update(i, patch)}
                    onRemove={() => removeInput({ projectId, menuId: menu.id, index: i })}
                    isInvalid={isInvalid}
                  />
                  {/* Unified Données section: an object param exposes its
                      nested lists (sets) right inside its card. */}
                  {input.type === "object" && input.rowOf ? (
                    <ObjectParamLists projectId={projectId} menu={menu} input={input} />
                  ) : null}
                </>
              ) : (
                <>
                  <SourceRefInputRow
                    projectId={projectId}
                    menu={menu}
                    input={input}
                    onChange={(patch) => update(i, patch)}
                    onRemove={() => removeInput({ projectId, menuId: menu.id, index: i })}
                  />
                  {input.ref ? <MenuSetBlock projectId={projectId} menu={menu} input={input} /> : null}
                </>
              )}
              {isInvalid ? (
                <div className="text-[10px] text-[var(--danger)]">
                  {input.name === ""
                    ? t("menuProperties.inputNeedsName")
                    : t("menuProperties.inputNameDup", { name: input.name })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("menuProperties.addInput")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
        >
          <DropdownMenuItem
            onSelect={() => addInput({ projectId, menuId: menu.id, kind: "primitive" })}
            className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
          >
            Primitive (caller-passed)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => addInput({ projectId, menuId: menu.id, kind: "sourceRef" })}
            className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
          >
            Source ref (manual for now)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PrimitiveInputRow({
  input,
  onChange,
  onRemove,
  isInvalid,
}: {
  input: Extract<ContextInput, { kind: "primitive" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "primitive" }>>) => void;
  onRemove: () => void;
  isInvalid: boolean;
}) {
  const { t } = useTranslation();
  // Typed row models: one entry per known data source — picking "Category
  // (boutique:categories)" stores type "object" + rowOf, giving the editor
  // the field schema (placeholder completion, preview candidates).
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  const selectValue =
    input.type === "object" && input.rowOf ? `row:${input.rowOf}` : input.type;
  return (
    <>
      {/* Row 1: name + type + remove button */}
      <div className="flex items-center gap-1.5">
        <Input
          value={input.name}
          placeholder={t("menuProperties.inputName")}
          onChange={(e) => onChange({ name: e.target.value })}
          className={
            isInvalid
              ? "h-8 w-28! shrink-0 border-[var(--danger)] px-2 py-0 font-mono text-xs"
              : "h-8 w-28! shrink-0 px-2 py-0 font-mono text-xs"
          }
        />
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("row:")) {
              onChange({ type: "object", rowOf: v.slice(4) as SourceRef });
            } else {
              onChange({
                type: v as Extract<ContextInput, { kind: "primitive" }>["type"],
                rowOf: undefined,
              });
            }
          }}
          className="h-8 min-w-0 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)]"
        >
          {PRIMITIVE_TYPES.map((typeOption) => (
            <option key={typeOption} value={typeOption}>
              {typeOption}
            </option>
          ))}
          {serverSources.length > 0 ? (
            <optgroup label={t("menuProperties.inputRowModels")}>
              {serverSources.map((src) => (
                <option key={src.ref} value={`row:${src.ref}`}>
                  {rowModelLabel(src.ref)} ({src.ref})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <button
          type="button"
          title={t("menuProperties.removeInput")}
          onClick={onRemove}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>
      {/* Row 2: default value */}
      <div className="flex items-center gap-2 pl-0.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {t("menuProperties.inputDefault")}:
          </span>
          <Input
            value={input.default === "{sender}" ? "" : (input.default ?? "")}
            placeholder={t("menuProperties.inputDefaultPlaceholder")}
            disabled={input.default === "{sender}"}
            onChange={(e) => onChange({ default: e.target.value || undefined })}
            className="h-7 w-28 px-2 py-0 font-mono text-xs disabled:opacity-40"
          />
        </div>
        {input.type === "player" ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
            <input
              type="checkbox"
              checked={input.default === "{sender}"}
              onChange={(e) => onChange({ default: e.target.checked ? "{sender}" : undefined })}
              className="h-3.5 w-3.5 accent-[var(--brand)]"
            />
            {t("menuProperties.inputSenderDefault")}
          </label>
        ) : null}
      </div>
    </>
  );
}

function SourceRefInputRow({
  projectId,
  menu,
  input,
  onChange,
  onRemove,
}: {
  projectId: ProjectId;
  menu: Menu;
  input: Extract<ContextInput, { kind: "sourceRef" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "sourceRef" }>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const serverSources = useServerDataSourcesStore((s) => s.sources);

  const refLabel = (() => {
    if (!input.ref) return null;
    if (input.ref.startsWith("pack:")) {
      const id = input.ref.slice("pack:".length);
      return (project?.dataSources ?? []).find((d) => d.id === id)?.name ?? input.ref;
    }
    return input.ref;
  })();

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Input
          value={input.name}
          placeholder={t("menuProperties.inputName")}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-8 w-28 px-2 py-0 font-mono text-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 flex-1 items-center justify-between gap-1 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0 font-mono text-xs text-[var(--text)] hover:bg-[var(--surface-raised-2)]"
            >
              <span className="truncate">{refLabel ?? t("menuProperties.refPickPlaceholder")}</span>
              <span className="text-[var(--text-faint)]">▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
          >
            {project ? <SourcePickerOptions project={project} onPick={(ref) => onChange({ ref })} /> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          title={t("menuProperties.removeInput")}
          onClick={onRemove}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>
      <SourceShapingEditor
        input={input}
        schemaFields={(serverSources.find((s) => s.ref === input.ref)?.schema ?? []).map((f) => f.name)}
        argNames={(menu.contextInputs ?? [])
          .filter((ci): ci is Extract<ContextInput, { kind: "primitive" }> => ci.kind === "primitive")
          .map((ci) => ci.name)
          .filter((n) => n !== "")}
        onChange={onChange}
      />
    </>
  );
}

function SourcePickerOptions({
  project,
  onPick,
}: {
  project: Project;
  onPick: (ref: SourceRef) => void;
}) {
  const { t } = useTranslation();
  const hasProjectData = (project.dataSources ?? []).length > 0;
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  const liveSources = serverSources;
  return (
    <>
      {hasProjectData ? (
        <>
          <DropdownMenuLabel className="text-[9px] uppercase text-[var(--text-faint)]">
            {t("menuProperties.refSectionProjectData")}
          </DropdownMenuLabel>
          {(project.dataSources ?? []).map((d) => (
            <DropdownMenuItem
              key={d.id}
              onSelect={() => onPick(`pack:${d.id}` as SourceRef)}
              title={summarizeFieldType(sourceFieldType(project, d))}
              className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
            >
              <span className="mr-1">{d.shape === "table" ? "🗂" : "📦"}</span>
              <span className="font-mono">{d.name}</span>
              <span className="ml-auto text-[9px] text-[var(--text-faint)]">
                {summarizeFieldType(sourceFieldType(project, d))}
              </span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {liveSources.length > 0 ? (
        <>
          {hasProjectData ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel className="text-[9px] uppercase text-[var(--text-faint)]">
            {t("menuProperties.refSectionServer")}
          </DropdownMenuLabel>
          {liveSources.map((s) => (
            <DropdownMenuItem
              key={s.ref}
              onSelect={() => onPick(s.ref as SourceRef)}
              title={s.schemaHint ?? undefined}
              className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
            >
              <span className="mr-1">🛰</span>
              <span className="font-mono">{s.ref}</span>
              {s.schemaHint ? (
                <span className="ml-auto text-[9px] text-[var(--text-faint)]">{s.schemaHint}</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {!hasProjectData && liveSources.length === 0 ? (
        <DropdownMenuItem
          disabled
          className="cursor-not-allowed text-[11px] text-[var(--text-faint)]"
        >
          {t("menuProperties.refNoSources")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
