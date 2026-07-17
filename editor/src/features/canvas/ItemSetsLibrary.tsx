import type { ItemTemplate, Project, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { resolveDisplayRef } from "@/domain/capturedItems";
import { headPreviewUrl } from "./headTexture";
import { moduleLocalRows, renderPreview } from "./menuPreviewScope";
import {
  TEMPLATE_BLOCK_DRAG_PREFIX,
  TEMPLATE_GROUP_DRAG_PREFIX,
  TEMPLATE_ROW_DRAG_PREFIX,
  type TemplateBlockDragData,
  type TemplateGroupDragData,
  type TemplateRowDragData,
} from "./placementDrop";
import { useTextureUrl } from "./textureStore";

/**
 * "Sets d'items" section of the Library tab — the everyday authoring surface of
 * Item templates (ADR `item-templates-and-data-library`). Each set materializes
 * by source stability:
 *   - static: real row tiles (grouped by `groupBy`), draggable onto a slot →
 *     placement; plus a "paginated grid" block tile → pagination.
 *   - dynamic: the block tile only (rows aren't enumerable at design time).
 * Unplaced rows stay listed — curation happens in the menu, not the library.
 */
export function ItemSetsLibrary({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const loadSnapshot = useServerSnapshotsStore((s) => s.loadSnapshot);
  const templates = pack?.itemTemplates ?? [];

  // Load the snapshot of every templated source so tiles show real rows. Keyed
  // on the JOINED refs (stable string), NOT the array identity — `?? []` mints
  // a fresh array every render and would loop the effect (and its fetch retries).
  const refsKey = templates.map((tpl) => tpl.sourceRef).join("\n");
  useEffect(() => {
    if (!networkId || !serverId || !refsKey) return;
    for (const ref of refsKey.split("\n")) loadSnapshot({ networkId, serverId, ref });
  }, [networkId, serverId, refsKey, loadSnapshot]);

  if (!pack) return null;
  if (templates.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--border)] px-4 py-6 text-center text-[11.5px] leading-relaxed text-[var(--text-mut)]">
        {t("itemTemplates.tabEmptyHint")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="item-sets-library">
      {templates.map((tpl) => (
        <TemplateGroup key={tpl.id} pack={pack} tpl={tpl} />
      ))}
    </div>
  );
}

function TemplateGroup({ pack, tpl }: { pack: Project; tpl: ItemTemplate }) {
  const { t } = useTranslation();
  const snapshotRows = useServerSnapshotsStore((s) => s.rowsByRef[tpl.sourceRef]);
  // Module-local rows (the form being edited) win over the server snapshot so
  // the tiles update live; the snapshot is the fallback for foreign projects.
  const rows = moduleLocalRows(pack, tpl.sourceRef) ?? snapshotRows;
  const activeLang = useUiStore((s) => s.activeLang);

  // Keys already placed somewhere (any menu) — shown with a ✓ so the admin sees
  // coverage at a glance. Unplaced rows stay listed (library ≠ curation).
  const placedKeys = useMemo(() => {
    const out = new Set<string>();
    for (const menu of pack.menus) {
      for (const layer of menu.layers) {
        for (const el of layer.elements) {
          if (el.places?.templateId !== tpl.id) continue;
          for (const p of el.places.placements) out.add(p.key);
        }
      }
    }
    return out;
  }, [pack.menus, tpl.id]);

  const isStatic = Boolean(tpl.keyField);
  const list = Array.isArray(rows) ? rows : [];

  // Group rows by the groupBy field value (library arrangement only).
  const groups = useMemo(() => {
    if (!tpl.groupBy) return [{ label: null as string | null, rows: list }];
    const byValue = new Map<string, Record<string, unknown>[]>();
    for (const row of list) {
      const v = String(row[tpl.groupBy] ?? "");
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v)!.push(row);
    }
    return [...byValue.entries()].map(([label, rows]) => ({ label, rows }));
  }, [list, tpl.groupBy]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="eyebrow">{tpl.name}</span>
        <span className="font-mono text-[9px] text-[var(--text-faint)]">{tpl.sourceRef}</span>
      </div>
      <BlockTile tpl={tpl} />
      {isStatic && list.length === 0 ? (
        <p className="text-[10px] text-[var(--text-faint)]">{t("itemTemplates.libraryNoRows")}</p>
      ) : null}
      {isStatic
        ? groups.map((g) => (
            <div key={g.label ?? "__all"} className="flex flex-col gap-1">
              {g.label !== null && tpl.groupBy ? (
                <GroupHeaderTile tpl={tpl} field={tpl.groupBy} value={g.label} />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {g.rows.map((row) => {
                  const key = String(row[tpl.keyField!] ?? "");
                  if (!key) return null;
                  return (
                    <RowTile
                      key={key}
                      pack={pack}
                      tpl={tpl}
                      row={row}
                      rowKey={key}
                      placed={placedKeys.has(key)}
                      activeLang={activeLang}
                    />
                  );
                })}
              </div>
            </div>
          ))
        : null}
    </div>
  );
}

/** Draggable group header — drops as a paginated element pre-filtered to this
 *  group (LITERAL filter, frozen at drop time). Same overlay pattern as tiles. */
function GroupHeaderTile({ tpl, field, value }: { tpl: ItemTemplate; field: string; value: string }) {
  const { t } = useTranslation();
  const data: TemplateGroupDragData = { templateGroup: { templateId: tpl.id, field, value } };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TEMPLATE_GROUP_DRAG_PREFIX}${tpl.id}:${value}`,
    data,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={t("itemTemplates.libraryGroupHint", { value })}
      {...listeners}
      {...attributes}
      className="w-fit touch-none cursor-grab select-none rounded px-1 font-mono text-[9px] uppercase tracking-wide text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      ⠿ {value || "—"}
    </button>
  );
}

/** Whole-set draggable block → drops as a paginated element bound to the template.
 *  No in-place transform: the drag visual is the route's shared DragOverlay
 *  (an in-place transform inside the scrollable library panel scrolls it). */
function BlockTile({ tpl }: { tpl: ItemTemplate }) {
  const { t } = useTranslation();
  const data: TemplateBlockDragData = { templateBlock: { templateId: tpl.id } };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TEMPLATE_BLOCK_DRAG_PREFIX}${tpl.id}`,
    data,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={t("itemTemplates.libraryBlockHint")}
      {...listeners}
      {...attributes}
      className="chip h-7 w-fit touch-none cursor-grab select-none px-2.5 text-[10.5px] active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      ≣ {t("itemTemplates.libraryBlockTile")}
    </button>
  );
}

/** One draggable row tile, rendered through the template (real icon + resolved title). */
function RowTile({
  pack,
  tpl,
  row,
  rowKey,
  placed,
  activeLang,
}: {
  pack: Project;
  tpl: ItemTemplate;
  row: Record<string, unknown>;
  rowKey: string;
  placed: boolean;
  activeLang: string;
}) {
  const app = tpl.appearances[0];
  const ctx = { [tpl.alias]: row };
  const rawMaterial = app?.material ? renderPreview(app.material, ctx, pack, activeLang) : "";
  // Captured-item refs (`item:<id>`) expand to their display descriptor.
  const display = resolveDisplayRef(pack, rawMaterial);
  const material = display.material;
  const titleRaw = app?.title ? getText(pack, app.title, activeLang) : "";
  const title = titleRaw ? renderPreview(titleRaw, ctx, pack, activeLang) : rowKey;
  // useTextureUrl is a hook — call unconditionally, THEN prefer the head render.
  const materialUrl = useTextureUrl(material);
  const textureUrl = headPreviewUrl(display.head) ?? materialUrl;
  const data: TemplateRowDragData = { templateRow: { templateId: tpl.id, key: rowKey, material } };
  // No in-place transform — the route's DragOverlay carries the drag visual
  // (transforming the tile inside the scrollable panel scrolls it instead).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TEMPLATE_ROW_DRAG_PREFIX}${tpl.id}:${rowKey}`,
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
        <span className="px-0.5 text-[8px] text-[var(--text-mut)]">{material.slice(0, 6) || rowKey.slice(0, 6)}</span>
      )}
      {placed ? (
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand)] text-[9px] text-white">
          ✓
        </span>
      ) : null}
    </button>
  );
}
