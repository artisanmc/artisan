import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { ContextInput, Element, Menu, Project, ProjectId } from "@/domain/types";
import { previewDataSource, type PreviewResult } from "@/lib/api/dataSources";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
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
    </div>
  );
}

type PreviewState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: PreviewResult };

function MenuSourceCard({ projectId, menu, input }: { projectId: ProjectId; menu: Menu; input: SourceRefInput }) {
  const { t } = useTranslation();
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));
  const argTokens = extractArgTokens(input);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const isLocal = input.ref.startsWith("pack:");

  const runPreview = async () => {
    if (!networkId || !serverId) return;
    setPreview({ kind: "loading" });
    const result = await previewDataSource(networkId, serverId, {
      ref: input.ref,
      params: input.params,
      filter: input.filter,
      sort: input.sort,
      limit: input.limit,
      args: testArgs,
    });
    setPreview({ kind: "done", result });
  };

  const errorLabel = (error: string, message: string | null): string => {
    switch (error) {
      case "server_offline": return t("dataSources.errServerOffline");
      case "fetch_timeout": return t("dataSources.errTimeout");
      case "unknown_source": return t("dataSources.errUnknownSource");
      case "player_required": return t("dataSources.errPlayerRequired");
      default: return t("dataSources.errFetchError", { message: message ?? "?" });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs">{input.ref}</span>
        {serverSource?.moduleId ? <Badge className="ml-auto">{serverSource.moduleId}</Badge> : null}
      </div>
      <div className="text-[10px] text-[var(--text-mut)]">{summarizeShaping(input, t)}</div>
      <MenuSetBlock projectId={projectId} menu={menu} input={input} />
      {isLocal ? (
        <div className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.menuDataLocalHint")}</div>
      ) : (
        <>
          {argTokens.length > 0 ? (
            <div className="flex flex-col gap-1">
              {argTokens.map((token) => (
                <label key={token} className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
                  <span className="font-mono">{t("menuProperties.testArgHint", { token: `{${token}}` })}</span>
                  <Input
                    data-testid={`test-arg-${token}`}
                    value={testArgs[token] ?? ""}
                    onChange={(e) => setTestArgs((prev) => ({ ...prev, [token]: e.target.value }))}
                    className="h-6 w-24! shrink-0 px-2 py-0 font-mono text-[10px]"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="menu-data-preview"
              disabled={preview.kind === "loading"}
              onClick={runPreview}
              className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2 py-1 text-[10px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:opacity-50"
            >
              {preview.kind === "loading" ? t("dataSources.previewLoading") : t("dataSources.preview")}
            </button>
          </div>
          {preview.kind === "done" && preview.result.ok ? (
            <DataTable
              rows={preview.result.rows}
              truncated={preview.result.truncated}
              truncatedLabel={t("dataSources.previewTruncated")}
              emptyLabel={t("dataSources.previewEmpty")}
            />
          ) : null}
          {preview.kind === "done" && !preview.result.ok ? (
            <div className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1 text-[10px] text-[var(--warning)]">
              {errorLabel(preview.result.error, preview.result.message)}
            </div>
          ) : null}
        </>
      )}
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
  const { t } = useTranslation();
  const createMenuSet = useAccountStore((s) => s.createMenuSet);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));
  if (!pack) return null;
  const el = findSetElement(menu, input.name);

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

  if (!el) {
    return (
      <div className="flex items-center gap-1.5" data-testid={`menu-set-${input.name}`}>
        <span className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.setNone")}</span>
        <button
          type="button"
          className="btn-ghost h-6 rounded px-2 text-[10px]"
          onClick={() =>
            createMenuSet({ projectId, menuId: menu.id, inputName: input.name, mode: "iterates", keyField, schema })
          }
        >
          {t("menuProperties.setCreatePaginate")}
        </button>
        <button
          type="button"
          className="btn-ghost h-6 rounded px-2 text-[10px]"
          onClick={() =>
            createMenuSet({ projectId, menuId: menu.id, inputName: input.name, mode: "places", keyField, schema })
          }
        >
          {t("menuProperties.setCreatePlace")}
        </button>
      </div>
    );
  }
  if (el.iterates) {
    return (
      <div className="text-[10px] text-[var(--text-mut)]" data-testid={`menu-set-${input.name}`}>
        {t("menuProperties.setPaginated", { positions: el.positions || "—" })}
      </div>
    );
  }
  return <PlacementRowsPanel menu={menu} element={el} pack={pack} />;
}

/**
 * Contextual placement panel: rows of the CURRENT preview context rendered
 * through the element's own appearance, draggable onto canvas slots (same
 * `row:` drop plumbing as MenuGroup). Placed rows show a check. Switching the
 * preview context ("Preview as…") reloads the list — place, switch, place.
 */
function PlacementRowsPanel({
  menu,
  element,
  pack,
}: {
  menu: Menu;
  element: Element;
  pack: Project;
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
      <div className="text-[10px] text-[var(--text-mut)]">
        {t("menuProperties.setPlacedCount", { count: places.placements.length })}
      </div>
      {Array.isArray(rows) && rows.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-1">
            {rows.map((row, i) => {
              const key = String(row[places.keyField] ?? i);
              return (
                <PlaceableRowTile
                  key={key}
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

/** One draggable row tile rendered through the element's own appearance. */
function PlaceableRowTile({
  pack,
  menu,
  element,
  row,
  rowKey,
  placed,
  activeLang,
}: {
  pack: Project;
  menu: Menu;
  element: Element;
  row: Record<string, unknown>;
  rowKey: string;
  placed: boolean;
  activeLang: string;
}) {
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
    placementRow: { menuId: menu.id, elementId: element.id, key: rowKey },
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PLACEMENT_ROW_DRAG_PREFIX}${element.id}:${rowKey}`,
    data,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={`${title} (${rowKey})`}
      {...listeners}
      {...attributes}
      className="relative flex h-12 w-12 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)] active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : placed ? 0.65 : 1 }}
    >
      {textureUrl ? (
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
      )}
      {placed ? (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand)] text-[9px] text-white">
          ✓
        </span>
      ) : null}
    </button>
  );
}
