import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { ContextInput, Element, Menu, Project, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { useAccountStore } from "@/state/accountStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { headPreviewUrl } from "../headTexture";
import { buildPreviewScope, renderPreview } from "../menuPreviewScope";
import { PLACEMENT_ROW_DRAG_PREFIX, type PlacementRowDragData } from "../placementDrop";
import { useTextureUrl } from "../textureStore";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

const ARG_TOKEN = /\{([a-z][a-z0-9_]*)\}/g;

/** `{arg}` tokens appearing in an input's filter/params values, deduped + sorted. */
export function extractArgTokens(input: SourceRefInput): string[] {
  const tokens = new Set<string>();
  const values = [...Object.values(input.filter ?? {}), ...Object.values(input.params ?? {})];
  for (const v of values) {
    for (const m of v.matchAll(ARG_TOKEN)) tokens.add(m[1]!);
  }
  return [...tokens].sort();
}

function summarizeShaping(input: SourceRefInput, t: (k: string) => string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input.filter ?? {})) parts.push(`${k} = ${v}`);
  if (input.sort?.by) parts.push(`${t("menuProperties.sortLabel")} ${input.sort.by} ${input.sort.direction ?? "asc"}`);
  if (input.limit != null) parts.push(`${t("menuProperties.limitLabel")} ${input.limit}`);
  return parts.length > 0 ? parts.join(" · ") : t("menuProperties.menuDataNoFilters");
}

/** "Données du menu": one card per consumed source, live preview with the menu's filters. */
export function MenuDataSection({ projectId, menu }: { projectId: ProjectId; menu: Menu }) {
  const { t } = useTranslation();
  const sourceInputs = (menu.contextInputs ?? []).filter(
    (i): i is SourceRefInput => i.kind === "sourceRef" && !!i.ref,
  );
  if (sourceInputs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="menu-data-section">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.menuData")}
      </div>
      {sourceInputs.map((input) => (
        <MenuSourceCard key={`${input.name}:${input.ref}`} projectId={projectId} menu={menu} input={input} />
      ))}
      <NestedListCards projectId={projectId} menu={menu} />
    </div>
  );
}

/**
 * Lists nested inside OBJECT params (e.g. `category.items` when the menu
 * receives a `category` row) are menu data too — one card each, with the same
 * Set d'items block. Field schema resolves from the object's `rowOf` source:
 * pack model when local, else the SIBLING server source named after the list
 * field (`boutique:categories` + `items` -> `boutique:items`).
 */
function NestedListCards({ projectId, menu }: { projectId: ProjectId; menu: Menu }) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  // Hand-typed paths (freedom over guessing — `category.meta.items`): local
  // until a set is created on them, then the ELEMENT keeps them alive.
  const [manualPaths, setManualPaths] = useState<string[]>([]);
  const [draftPath, setDraftPath] = useState("");
  if (!pack) return null;
  const objectInputs = (menu.contextInputs ?? []).filter(
    (i): i is Extract<ContextInput, { kind: "primitive" }> =>
      i.kind === "primitive" && i.type === "object" && !!i.rowOf,
  );
  const lists = objectInputs.flatMap((input) => {
    const ref = String(input.rowOf);
    if (ref.startsWith("pack:")) {
      const ds = pack.dataSources?.find((d) => `pack:${d.id}` === ref);
      const model =
        ds?.shape === "table" ? (pack.dataModels ?? []).find((m) => m.id === ds.modelId) : undefined;
      // Recursive walk: lists at ANY depth inside the object's row model
      // (`category.meta.items`), through nested objects and model refs
      // (cycle-guarded). Lists inside lists are not addressable (no index).
      const out: { path: string; schema: { name: string }[]; keyField: string }[] = [];
      const models = pack.dataModels ?? [];
      const walk = (
        fields: { name: string; type: import("@/domain/types").ModelFieldType }[],
        base: string,
        visited: Set<string>,
      ): void => {
        for (const f of fields) {
          const ty = f.type;
          if (ty.kind === "list") {
            const of = ty.of;
            const elModel = of.kind === "model" ? models.find((m) => m.id === of.ref) : undefined;
            const elFields = elModel?.fields ?? (of.kind === "object" ? of.fields : []);
            out.push({
              path: `${base}.${f.name}`,
              schema: elFields.map((x) => ({ name: x.name })),
              keyField: elModel?.keyField ?? "id",
            });
          } else if (ty.kind === "object") {
            walk(ty.fields, `${base}.${f.name}`, visited);
          } else if (ty.kind === "model") {
            const m = models.find((x) => x.id === ty.ref);
            if (m && !visited.has(String(m.id))) {
              walk(m.fields, `${base}.${f.name}`, new Set(visited).add(String(m.id)));
            }
          }
        }
      };
      walk(model?.fields ?? [], input.name, new Set(model ? [String(model.id)] : []));
      return out;
    }
    // Server schemas are FLAT — but dotted field names ("meta.items") work
    // naturally: the path concatenates and the runtime resolves any depth.
    const src = serverSources.find((s) => s.ref === ref);
    const ns = ref.split(":")[0];
    return (src?.schema ?? [])
      .filter((f) => f.type === "list")
      .map((f) => {
        const tail = f.name.split(".").pop()!;
        const sibling = serverSources.find((s) => s.ref === `${ns}:${tail}`);
        return {
          path: `${input.name}.${f.name}`,
          schema: (sibling?.schema ?? []).map((x) => ({ name: x.name })),
          keyField: sibling?.keyField ?? "id",
        };
      });
  });
  // Paths already consumed by a set element (survives reloads) + hand-typed
  // drafts, minus the auto-detected ones.
  const known = new Set(lists.map((l) => l.path));
  const inputNames = new Set((menu.contextInputs ?? []).map((c) => c.name));
  const elementPaths = menu.layers
    .flatMap((l) => l.elements)
    .flatMap((e) => [e.iterates?.source, e.places?.source])
    .filter((s): s is string => !!s && s.includes(".") && !known.has(s));
  const extraPaths = [...new Set([...elementPaths, ...manualPaths.filter((m) => !known.has(m))])];
  const rootOk = (path: string) => inputNames.has(path.split(".")[0]!);

  const addDraft = () => {
    const path = draftPath.trim();
    if (path === "" || !path.includes(".") || !rootOk(path) || known.has(path) || extraPaths.includes(path)) {
      return;
    }
    setManualPaths((prev) => [...prev, path]);
    setDraftPath("");
  };

  if (lists.length === 0 && extraPaths.length === 0 && objectInputs.length === 0) return null;
  return (
    <>
      {lists.map((l) => (
        <div
          key={l.path}
          className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5"
        >
          <span className="truncate font-mono text-xs">{l.path}</span>
          <MenuSetBlockCore
            projectId={projectId}
            menu={menu}
            listName={l.path}
            schema={l.schema}
            keyField={l.keyField}
          />
        </div>
      ))}
      {extraPaths.map((path) => (
        <div
          key={path}
          className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5"
        >
          <span className="truncate font-mono text-xs">{path}</span>
          <MenuSetBlockCore projectId={projectId} menu={menu} listName={path} schema={[]} keyField="id" />
        </div>
      ))}
      {objectInputs.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDraft()}
            placeholder={t("menuProperties.setAddPathPlaceholder")}
            className="h-6 flex-1 px-2 font-mono text-[10px]"
            aria-label={t("menuProperties.setAddPath")}
          />
          <Button variant="secondary" size="sm" onClick={addDraft}>
            {t("menuProperties.setAddPath")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function MenuSourceCard({ projectId, menu, input }: { projectId: ProjectId; menu: Menu; input: SourceRefInput }) {
  const { t } = useTranslation();
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs">{input.ref}</span>
        {serverSource?.moduleId ? <Badge className="ml-auto">{serverSource.moduleId}</Badge> : null}
      </div>
      <div className="text-[10px] text-[var(--text-mut)]">{summarizeShaping(input, t)}</div>
      <MenuSetBlock projectId={projectId} menu={menu} input={input} />
    </div>
  );
}

// ─── Set d'items du menu (ADR item-templates… révisé : le set vit au MENU) ───

/** The element consuming this menu list, either mode. */
function findSetElement(menu: Menu, inputName: string): Element | undefined {
  return menu.layers
    .flatMap((l) => l.elements)
    .find((e) => e.iterates?.source === inputName || e.places?.source === inputName);
}

/**
 * Per-list "Set d'items" block: create the set (paginated / placed 1-by-1) or
 * show its state. Placement mode opens the CONTEXTUAL row panel: the rows
 * offered are those of the current preview context (e.g. the boutique category
 * selected in "Preview as…"), so the admin navigates category by category and
 * places items. The created element is SELF-CONTAINED (no Item template).
 */
function MenuSetBlock({
  projectId,
  menu,
  input,
}: {
  projectId: ProjectId;
  menu: Menu;
  input: SourceRefInput;
}) {
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));
  if (!pack) return null;

  // Schema + Row key: pack: sources from the project, server sources from presence.
  const packDs = input.ref.startsWith("pack:")
    ? pack.dataSources?.find((d) => `pack:${d.id}` === input.ref)
    : undefined;
  const packModel =
    packDs?.shape === "table" ? (pack.dataModels ?? []).find((m) => m.id === packDs.modelId) : undefined;
  const schema: { name: string }[] = packDs
    ? (packDs.shape === "table" ? (packModel?.fields ?? []) : packDs.fields).map((f) => ({ name: f.name }))
    : (serverSource?.schema ?? []).map((f) => ({ name: f.name }));
  const keyField = packModel?.keyField ?? serverSource?.keyField ?? "id";
  return (
    <MenuSetBlockCore projectId={projectId} menu={menu} listName={input.name} schema={schema} keyField={keyField} />
  );
}

/** The Set d'items block for ONE menu list — `listName` may be a plain input
 *  name or a dotted path into an object param (`category.items`). */
function MenuSetBlockCore({
  projectId,
  menu,
  listName,
  schema,
  keyField,
}: {
  projectId: ProjectId;
  menu: Menu;
  listName: string;
  schema: { name: string }[];
  keyField: string;
}) {
  const { t } = useTranslation();
  const createMenuSet = useAccountStore((s) => s.createMenuSet);
  const deleteElement = useAccountStore((s) => s.deleteElement);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  if (!pack) return null;
  const el = findSetElement(menu, listName);

  if (!el) {
    return (
      <div className="flex items-center gap-1.5" data-testid={`menu-set-${listName}`}>
        <span className="text-[10px] text-[var(--text-mut)]">{t("menuProperties.setPlaceLead")}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            createMenuSet({ projectId, menuId: menu.id, inputName: listName, mode: "places", keyField, schema })
          }
        >
          {t("menuProperties.setCreatePlace")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            createMenuSet({ projectId, menuId: menu.id, inputName: listName, mode: "iterates", keyField, schema })
          }
        >
          {t("menuProperties.setCreatePaginate")}
        </Button>
      </div>
    );
  }
  const deleteSet = () => {
    const placedCount = el.places?.placements.length ?? 0;
    if (placedCount > 0 && !window.confirm(t("menuProperties.setDeleteConfirm", { count: placedCount }))) {
      return;
    }
    deleteElement({ projectId, menuId: menu.id, elementId: el.id as never });
  };
  if (el.iterates) {
    return (
      <div className="flex items-center gap-1.5" data-testid={`menu-set-${listName}`}>
        <span className="text-[10px] text-[var(--text-mut)]">
          {t("menuProperties.setPaginated", { positions: el.positions || "—" })}
        </span>
        <button
          type="button"
          onClick={deleteSet}
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
        >
          ✕ {t("menuProperties.setDelete")}
        </button>
      </div>
    );
  }
  return (
    <PlacementRowsPanel projectId={projectId} menu={menu} element={el} pack={pack} onDelete={deleteSet} />
  );
}

/**
 * Contextual placement panel: rows of the CURRENT preview context rendered
 * through the element's own appearance, draggable onto canvas slots (same
 * `row:` drop plumbing as MenuGroup). Placed rows show a check. Switching the
 * preview context ("Preview as…") reloads the list — place, switch, place.
 */
function PlacementRowsPanel({
  projectId,
  menu,
  element,
  pack,
  onDelete,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  pack: Project;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const activeLang = useUiStore((s) => s.activeLang);
  const places = element.places;
  if (!places) return null;
  const baseCtx = buildPreviewScope(menu, pack, snapshots, menuPreviewArgs[menu.id]);
  const rows = (lookupPath(baseCtx, places.source) ?? []) as Record<string, unknown>[];
  const placedKeys = new Set(places.placements.map((p) => p.key));

  return (
    <div className="flex flex-col gap-1" data-testid={`menu-set-${places.source}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--text-mut)]">
          {t("menuProperties.setPlacedCount", { count: places.placements.length })}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
        >
          ✕ {t("menuProperties.setDelete")}
        </button>
      </div>
      {Array.isArray(rows) && rows.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-1">
            {rows.map((row, i) => {
              const key = String(row[places.keyField] ?? i);
              return (
                <PlaceableRowTile
                  key={key}
                  projectId={projectId}
                  pack={pack}
                  menu={menu}
                  element={element}
                  row={row}
                  rowKey={key}
                  placed={placedKeys.has(key)}
                  activeLang={activeLang}
                />
              );
            })}
          </div>
          <div className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.setPanelHint")}</div>
        </>
      ) : (
        <div className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.setNoRows")}</div>
      )}
    </div>
  );
}

/** One row tile rendered through the element's own appearance: draggable when
 *  free, click-to-UNPLACE when already placed (removes just that placement,
 *  never the set). */
function PlaceableRowTile({
  projectId,
  pack,
  menu,
  element,
  row,
  rowKey,
  placed,
  activeLang,
}: {
  projectId: ProjectId;
  pack: Project;
  menu: Menu;
  element: Element;
  row: Record<string, unknown>;
  rowKey: string;
  placed: boolean;
  activeLang: string;
}) {
  const { t } = useTranslation();
  const removeElementPlacement = useAccountStore((s) => s.removeElementPlacement);
  const app = element.appearances[0];
  const alias = element.places?.alias ?? "item";
  const ctx = { [alias]: row };
  const rawMaterial = app?.material ? renderPreview(app.material, ctx, pack, activeLang) : "";
  const display = resolveDisplayRef(pack, rawMaterial);
  const material = display.material;
  const titleRaw = app?.title ? getText(pack, app.title, activeLang) : "";
  const title = titleRaw ? renderPreview(titleRaw, ctx, pack, activeLang) : rowKey;
  const materialUrl = useTextureUrl(material);
  const textureUrl = headPreviewUrl(display.head) ?? materialUrl;
  const data: PlacementRowDragData = {
    placementRow: { menuId: menu.id, elementId: element.id, key: rowKey, material },
  };
  // Hook order: useDraggable runs unconditionally; listeners only bind when free.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PLACEMENT_ROW_DRAG_PREFIX}${element.id}:${rowKey}`,
    data,
    disabled: placed,
  });

  const icon = textureUrl ? (
    <img
      src={textureUrl}
      alt={title}
      draggable={false}
      className="h-3/4 w-3/4 object-contain"
      style={{ imageRendering: "pixelated" }}
    />
  ) : (
    <span className="px-0.5 text-[8px] text-[var(--text-mut)]">
      {material.slice(0, 6) || rowKey.slice(0, 6)}
    </span>
  );

  if (placed) {
    return (
      <button
        type="button"
        title={t("menuProperties.setUnplaceHint", { title })}
        onClick={() =>
          removeElementPlacement({ projectId, menuId: menu.id, elementId: element.id, key: rowKey })
        }
        className="group relative flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] opacity-65 hover:border-rose-400/70 hover:opacity-90"
      >
        {icon}
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand)] text-[9px] text-white group-hover:bg-rose-500">
          <span className="group-hover:hidden">✓</span>
          <span className="hidden group-hover:inline">✕</span>
        </span>
      </button>
    );
  }
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={`${title} (${rowKey})`}
      {...listeners}
      {...attributes}
      className="relative flex h-12 w-12 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)] active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {icon}
    </button>
  );
}
