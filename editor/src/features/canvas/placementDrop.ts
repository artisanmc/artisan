import type { ElementId, MenuId, Placement, ProjectId } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { useAccountStore } from "@/state/accountStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { buildPreviewScope } from "./menuPreviewScope";
import { capturePlacementCache, matchPlacementRow } from "./placement";

/** @dnd-kit id prefix for a draggable palette row. Payload rides in `data`. */
export const PLACEMENT_ROW_DRAG_PREFIX = "row:";

/** `data.current` shape carried by a palette-row draggable. */
export interface PlacementRowDragData {
  /** `material` = resolved preview material — feeds the shared drag overlay. */
  placementRow: { menuId: string; elementId: string; key: string; material?: string };
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
  const project = account.account.projects.find((p) => p.id === projectId);
  const menu = project?.menus.find((m) => m.id === menuId);
  const el = menu?.layers.flatMap((l) => l.elements).find((e) => e.id === elementId);
  if (!project || !menu || !el?.places) return;
  const appearance = el.appearances[0];

  const page = usePaginationStore.getState().pageByElement[elementId] ?? 0;
  const snapshots = useServerSnapshotsStore.getState().rowsByRef;
  const activeLang = useUiStore.getState().activeLang;
  const baseCtx = buildPreviewScope(menu, project, snapshots, useUiStore.getState().menuPreviewArgs[menu.id]);
  const rows = lookupPath(baseCtx, el.places.source);
  const row = matchPlacementRow(rows, el.places.keyField, key);
  const cachedDisplay =
    row && appearance
      ? capturePlacementCache({ places: el.places, appearance, row, baseCtx, project, activeLang })
      : undefined;

  const placement: Placement = { key, page, position };
  if (cachedDisplay && Object.keys(cachedDisplay).length > 0) placement.cachedDisplay = cachedDisplay;

  account.setElementPlacement({ projectId, menuId, elementId, placement });
}

