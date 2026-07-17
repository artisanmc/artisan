import type { ElementId, ItemTemplateId, MenuId, Placement, ProjectId } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { useAccountStore } from "@/state/accountStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { buildPreviewScope, moduleLocalRows } from "./menuPreviewScope";
import { capturePlacementCache, matchPlacementRow, resolveAppearance0 } from "./placement";

/** @dnd-kit id prefix for a draggable palette row. Payload rides in `data`. */
export const PLACEMENT_ROW_DRAG_PREFIX = "row:";

/** `data.current` shape carried by a palette-row draggable. */
export interface PlacementRowDragData {
  placementRow: { menuId: string; elementId: string; key: string };
}

/** @dnd-kit id prefixes for library Item-template draggables (row / group / whole-set block). */
export const TEMPLATE_ROW_DRAG_PREFIX = "tplrow:";
export const TEMPLATE_GROUP_DRAG_PREFIX = "tplgroup:";
export const TEMPLATE_BLOCK_DRAG_PREFIX = "tplblock:";

export interface TemplateRowDragData {
  /** `material` = resolved preview material — feeds the shared drag overlay. */
  templateRow: { templateId: string; key: string; material?: string };
}
/** A `groupBy` group header drop → paginated element with a LITERAL filter. */
export interface TemplateGroupDragData {
  templateGroup: { templateId: string; field: string; value: string };
}
export interface TemplateBlockDragData {
  templateBlock: { templateId: string };
}

/**
 * Pin a static-source row into an element's placement layout at `position` on the
 * currently-viewed page, snapshotting a display cache for offline render. Shared
 * by the canvas row-drop (route onDragEnd) and the tap-to-place fallback so the
 * cache-capture + override-preservation logic lives in one place. No-op unless
 * the element is in placement mode.
 */
export function pinPlacementRow(opts: {
  projectId: ProjectId;
  menuId: MenuId;
  elementId: ElementId;
  key: string;
  position: number;
}): void {
  const { projectId, menuId, elementId, key, position } = opts;
  const account = useAccountStore.getState();
  const pack = account.account.projects.find((p) => p.id === projectId);
  const menu = pack?.menus.find((m) => m.id === menuId);
  const el = menu?.layers.flatMap((l) => l.elements).find((e) => e.id === elementId);
  if (!pack || !menu || !el?.places) return;
  const appearance = resolveAppearance0(pack, el);

  const page = usePaginationStore.getState().pageByElement[elementId] ?? 0;
  const snapshots = useServerSnapshotsStore.getState().rowsByRef;
  const activeLang = useUiStore.getState().activeLang;
  const baseCtx = buildPreviewScope(menu, pack, snapshots);
  const rows = lookupPath(baseCtx, el.places.source);
  const row = matchPlacementRow(rows, el.places.keyField, key);
  const cachedDisplay =
    row && appearance
      ? capturePlacementCache({ places: el.places, appearance, row, baseCtx, pack, activeLang })
      : undefined;

  const placement: Placement = { key, page, position };
  if (cachedDisplay && Object.keys(cachedDisplay).length > 0) placement.cachedDisplay = cachedDisplay;

  account.setElementPlacement({ projectId, menuId, elementId, placement });
}

/**
 * Library-tile drop: pin one row of an Item template onto a menu slot. Captures
 * the offline `cachedDisplay` from the live snapshot + template appearance, then
 * delegates to the store (which auto-creates the contextInput + bound element on
 * first drop and enforces one-set-per-(menu, source)). Returns the store result
 * so the caller can toast a conflict.
 */
export function pinTemplateRowFromLibrary(opts: {
  projectId: ProjectId;
  menuId: MenuId;
  templateId: ItemTemplateId;
  key: string;
  position: number;
}): ReturnType<ReturnType<typeof useAccountStore.getState>["pinItemTemplateRow"]> {
  const { projectId, menuId, templateId, key, position } = opts;
  const account = useAccountStore.getState();
  const pack = account.account.projects.find((p) => p.id === projectId);
  const tpl = pack?.itemTemplates?.find((t) => t.id === templateId);
  if (!pack || !tpl) return { ok: true };
  const rows =
    moduleLocalRows(pack, tpl.sourceRef) ??
    useServerSnapshotsStore.getState().rowsByRef[tpl.sourceRef];
  const row = matchPlacementRow(rows, tpl.keyField ?? "", key);
  const appearance = tpl.appearances[0];
  const activeLang = useUiStore.getState().activeLang;
  const cachedDisplay =
    row && appearance
      ? capturePlacementCache({
          places: { source: "", alias: tpl.alias, keyField: tpl.keyField ?? "", placements: [] },
          appearance,
          row,
          baseCtx: {},
          pack,
          activeLang,
        })
      : undefined;
  return account.pinItemTemplateRow({ projectId, menuId, templateId, key, position, cachedDisplay });
}
