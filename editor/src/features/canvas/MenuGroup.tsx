import { resolveDisplayRef } from "@/domain/capturedItems";
import type { ElementId, Menu, Placement, ProjectId } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useCssVar } from "@/lib/themeColors";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useHoverStore } from "@/state/hoverStore";
import { useNetworksStore } from "@/state/networksStore";
import { usePaginationStore } from "@/state/paginationStore";
import { isElementSelected, useSelectionStore } from "@/state/selectionStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useMemo } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import { toast } from "sonner";
import useImage from "use-image";
import { ImageButtonsRender } from "./ImageButtonsRender";
import { PaginationControls } from "./PaginationControls";
import { PlacementTray } from "./PlacementTray";
import { PreviewContextBanner } from "./PreviewContextBanner";
import { SlotItem } from "./SlotItem";
import { dispatchOpenElement } from "./canvasEvents";
import { INVENTORY_TYPES, slotCount } from "./inventoryTypes";
import { previewItem } from "./itemValuePreview";
import { type SlotEntry, fanoutElements } from "./menuFanout";
import {
  TEXTURE_URLS,
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  singleBackgroundCrop,
  slotXY,
  topPieceCrop,
  usesSingleBackground,
} from "./menuLayout";
import { buildPreviewScope } from "./menuPreviewScope";
import {
  type PlacementSlotInfo,
  matchPlacementRow,
  placementTotalPages,
  resolvePlacementSlot,
} from "./placement";
import { pinPlacementRow } from "./placementDrop";
import { sourceIsContextFiltered } from "./placementScope";
import { TitleRender } from "./title/composer/TitleRender";
import { useMenuClick } from "./useMenuClick";
import { useMenuDrag } from "./useMenuDrag";
import { useNodeAlignment } from "./useNodeAlignment";
import { useSlotDrag } from "./useSlotDrag";

interface MenuGroupProps {
  projectId: ProjectId;
  menu: Menu;
  position: { x: number; y: number };
  /** Full project-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
  /** Solo mode: render at origin, non-draggable, no menu-level drag/select
   *  handlers. Slot-level handlers (click-to-edit, library placement) remain
   *  active. Used by the individual-element view so it reuses this component
   *  without diverging. */
  solo?: boolean;
}

/**
 * MenuGroup is a Konva Group composing a vanilla-Minecraft chest GUI
 * representation: title bar + N-row chest slot grid + 4-row player inventory
 * (always visible, non-interactive). The default rendering uses the actual
 * `generic_54.png` vanilla texture, sliced into top + bottom pieces so the
 * chest height adapts to `menu.rows`. A custom uploaded background image
 * replaces BOTH slices and covers the full menu box.
 *
 * Slot interactivity (click-bubbles-up to select menu, drag-out to clear/move)
 * sits on Group overlays positioned at each chest slot's outer cell. The
 * texture itself draws the visual slot wells; we just overlay material text
 * + interaction targets.
 */
export function MenuGroup({ projectId, menu, position, layout, solo = false }: MenuGroupProps) {
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(menu.id));
  const selectedIds = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const focusedSlot = useSelectionStore((s) => s.focusedSlot);
  const hoveredEdge = useEdgeHoverStore((s) => s.edge);
  const brand = useCssVar("--brand");
  const borderStrong = useCssVar("--border-strong");
  const warning = useCssVar("--warning");
  // Walk layers directly (not elementsByPosition) so out-of-range positions
  // still get highlighted — the element may have been moved outside the grid.
  const edgeTriggerPositions = useMemo(() => {
    if (!hoveredEdge) return null;
    const triggerIds = new Set(
      hoveredEdge.triggers.filter((t) => t.kind === "element").map((t) => t.elementId),
    );
    const positions = new Set<number>();
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        if (!triggerIds.has(el.id)) continue;
        for (const p of parsePositions(el.positions)) positions.add(p);
      }
    }
    return positions;
  }, [hoveredEdge, menu.layers]);

  // Placement tap-to-place: while a row is armed for THIS menu, every slot
  // (including empty ones) becomes a tap target that pins the row.
  const armedPlacement = useUiStore((s) => s.armedPlacement);
  const armedForThisMenu = armedPlacement?.menuId === menu.id;

  const type = menu.inventoryType ?? "chest";
  const [tex] = useImage(TEXTURE_URLS[INVENTORY_TYPES[type].textureKey]);
  const box = menuBoxSize(type, menu.rows);
  const single = usesSingleBackground(type);

  const { onMenuDragStart, onMenuDragEnd } = useMenuDrag({ projectId, menuId: menu.id, position });
  const nodeAlign = useNodeAlignment(projectId, menu.id);

  const { onClick } = useMenuClick({ projectId, menu, layout });

  const { dragState, onSlotDragStart, onSlotDragMove, onSlotDragEnd } = useSlotDrag({
    projectId,
    menuId: menu.id,
    position,
    layout,
    menuLayers: menu.layers,
    inventoryType: type,
  });

  // Fanout: Map<elementId, SlotEntry[]> — single source of truth for both
  // materialized and phantom (no-material) slots; O(1) per-element lookup.
  const fannedSlotsByElement = useMemo(() => {
    const map = new Map<string, SlotEntry[]>();
    for (const entry of fanoutElements(menu.layers)) {
      const key = entry.elementId as string;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [menu.layers]);

  // Active language + project ref so we can resolve `LText` refs (menu
  // title, appearance titles, lore lines) into the actually-displayed
  // string. Project ref is stable thanks to immer; the resolver reads
  // `project.i18nKeys[lt.key][activeLang]` with fallback to defaultLang.
  // For `iterates` elements, positions are unrolled against the preview
  // scope; each position i binds the i-th item with placeholder resolution.
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  // Live-server snapshots (cached via preview) so the canvas renders REAL rows
  // for module sources, not just the static connector sample. Loaded below.
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const loadSnapshot = useServerSnapshotsStore((s) => s.loadSnapshot);
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  // Whose eyes we preview through: a per-player source returns nothing useful
  // with `player = null`, so pass the chosen player down to the fetcher.
  const previewPlayer = useUiStore((s) => s.previewPlayer);
  useEffect(() => {
    if (!networkId || !serverId) return;
    for (const input of menu.contextInputs ?? []) {
      if (input.kind === "sourceRef" && !String(input.ref).startsWith("pack:")) {
        // The input's own params (`group: daily`) still apply — the preview player
        // is added to them, it does not replace them.
        const declared = (input.params ?? {}) as Record<string, string>;
        const params = previewPlayer ? { ...declared, player: previewPlayer } : declared;
        loadSnapshot({
          networkId,
          serverId,
          ref: String(input.ref),
          ...(Object.keys(params).length > 0 ? { params } : {}),
        });
      }
    }
  }, [menu.contextInputs, networkId, serverId, loadSnapshot, previewPlayer]);
  // Build a preview scope from contextInputs — primitives are coerced to their
  // declared type; sourceRefs resolve against a live snapshot (server sources)
  // with project.dataSources as the project-data path.
  const previewArgs = useUiStore((s) => s.menuPreviewArgs[menu.id]);
  const sampleCtx = project ? buildPreviewScope(menu, project, snapshots, previewArgs) : {};
  const activeLang = useUiStore((s) => s.activeLang);
  // Per-element page index for iteration overflow. Shared via
  // paginationStore so the ItemTooltip (which renders outside MenuGroup)
  // can resolve placeholders against the right item on hover.
  const pageByElement = usePaginationStore((s) => s.pageByElement);
  const setPage = usePaginationStore((s) => s.setPage);
  // Iterating elements that overflow their position count → eligible for
  // pagination. We collect them as we build elementsByPosition so the
  // overlay below can render controls per-element.
  const overflowing: { elementId: string; page: number; totalPages: number }[] = [];

  // First pass: walk all iterating elements to compute pagination state
  // per-element. We expose this through the resolution context so users
  // can write `{pagination.page}` / `{pagination.totalPages}` (defaults
  // to the first iterable in the menu) or `{pagination.<source>.page}`
  // / `{pagination.<source>.totalPages}` to disambiguate when several
  // iterables coexist. Pages are 1-indexed for display.
  const paginationCtx: Record<string, unknown> = {};
  let firstIterable: { page: number; totalPages: number } | null = null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.display;
      if (!appearance) continue;
      let source: string;
      let totalPages: number;
      if (el.iterates) {
        const positions = parsePositions(el.positions);
        const list = lookupPath(sampleCtx, el.iterates.source);
        const items = Array.isArray(list) ? list : [];
        const perPage = Math.max(1, positions.length);
        totalPages = Math.max(1, Math.ceil(items.length / perPage));
        source = el.iterates.source;
      } else if (el.places) {
        // Placement layouts reuse the same in-menu pagination navigation.
        totalPages = placementTotalPages(el.places.placements);
        source = el.places.source;
      } else {
        continue;
      }
      const rawPage = pageByElement[el.id] ?? 0;
      const page = Math.min(Math.max(0, rawPage), totalPages - 1);
      const entry = { page: page + 1, totalPages };
      paginationCtx[source] = entry;
      if (!firstIterable) firstIterable = entry;
    }
  }
  if (firstIterable) {
    paginationCtx.page = firstIterable.page;
    paginationCtx.totalPages = firstIterable.totalPages;
  }
  const enhancedCtx: Record<string, unknown> = { ...sampleCtx, pagination: paginationCtx };

  const elementsByPosition = new Map<
    number,
    {
      material?: string;
      head?: string;
      title?: string;
      count?: number;
      /** Draws the glint marker — real enchantments, or the bare glint flag. */
      enchanted?: boolean;
      elementId: string;
      multiPos: boolean;
      image?: boolean;
    }
  >();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.display;
      if (!appearance) continue;
      const enchanted =
        appearance.enchanted === true || (appearance.enchants?.length ?? 0) > 0 || undefined;

      if (el.iterates) {
        const positions = parsePositions(el.positions);
        const list = lookupPath(sampleCtx, el.iterates.source);
        const items = Array.isArray(list) ? list : [];
        const perPage = Math.max(1, positions.length);
        const totalPages = Math.max(1, Math.ceil(items.length / perPage));
        const rawPage = pageByElement[el.id] ?? 0;
        const page = Math.min(Math.max(0, rawPage), totalPages - 1);
        const offset = page * perPage;
        if (totalPages > 1) overflowing.push({ elementId: el.id, page, totalPages });

        // First, claim every position with a phantom entry (no material
        // → renders the dashed-outline placeholder + remains clickable
        // and selectable). This way the user can SEE which slots are
        // reserved by the iterating element even when the data list is
        // shorter than the position count or empty entirely. Slots that
        // resolve to an item below override their phantom with the real
        // appearance.
        for (const p of positions) {
          elementsByPosition.set(p, {
            elementId: el.id,
            multiPos: false,
          });
        }

        // Empty-list preview: still render the first slot with the bare
        // appearance (literal placeholders like {shop.name}) so the user
        // sees the button shape they're configuring even when the data
        // list is empty.
        if (items.length === 0) {
          elementsByPosition.set(positions[0]!, {
            material: appearance.material,
            head: appearance.head,
            count: appearance.count,
            enchanted,
            ...(project ? previewItem(appearance, enhancedCtx, project, activeLang) : {}),
            elementId: el.id,
            multiPos: false,
          });
          continue;
        }

        for (let i = 0; i < perPage && offset + i < items.length; i++) {
          const item = items[offset + i];
          const itemCtx = { ...enhancedCtx, [el.iterates.alias]: item };
          elementsByPosition.set(positions[i]!, {
            material: appearance.material,
            head: appearance.head,
            count: appearance.count,
            enchanted,
            ...(project ? previewItem(appearance, itemCtx, project, activeLang) : {}),
            elementId: el.id,
            multiPos: false,
          });
        }
        continue;
      }

      if (el.places && project) {
        // Placement mode: pin specific rows of a static source to hand-authored
        // page+slots. Rows are matched by keyField; the live snapshot wins, then
        // the placement's cachedDisplay, else the slot renders empty (dangling).
        const places = el.places;
        const totalPages = placementTotalPages(places.placements);
        const rawPage = pageByElement[el.id] ?? 0;
        const page = Math.min(Math.max(0, rawPage), totalPages - 1);
        if (totalPages > 1) overflowing.push({ elementId: el.id, page, totalPages });
        const rows = lookupPath(sampleCtx, places.source);
        const rowsAvailable = Array.isArray(rows);
        // Two passes: a RESOLVED row always wins its slot over an unresolved
        // one. When the source is filtered (a category menu shows one
        // category's items), every other context's placements resolve to
        // nothing — authored on the same slots on purpose, since only one
        // context is ever live at runtime. Setting them in authoring order let
        // a later empty placement erase an earlier real item, so items
        // "disappeared" as soon as another category reused their slot.
        const resolved: { placement: Placement; info: PlacementSlotInfo }[] = [];
        const unresolved: { placement: Placement; info: PlacementSlotInfo }[] = [];
        for (const placement of places.placements) {
          if (placement.page !== page) continue;
          const row = matchPlacementRow(rows, places.keyField, placement.key);
          const info = resolvePlacementSlot({
            places,
            appearance,
            placement,
            row,
            rowsAvailable,
            baseCtx: enhancedCtx,
            project,
            activeLang,
            elementId: el.id,
          });
          (info.dangling ? unresolved : resolved).push({ placement, info });
        }
        for (const { placement, info } of resolved) {
          elementsByPosition.set(placement.position, info);
        }
        // Une source filtrée par le contexte ne rend qu'une tranche du tout :
        // les placements des AUTRES contextes n'y résolvent rien, et ce n'est
        // pas une anomalie — ils sont posés sur les mêmes slots à dessein. Les
        // afficher couvrait le menu de cases pointillées, au point de faire
        // croire à un territoire réservé de mode paginé en plein placement.
        //
        // Sans filtre contextuel, la même absence est un vrai trou (ligne
        // supprimée) et doit se voir.
        if (!sourceIsContextFiltered(menu, places.source)) {
          for (const { placement, info } of unresolved) {
            if (!elementsByPosition.has(placement.position)) {
              elementsByPosition.set(placement.position, info);
            }
          }
        }
        continue;
      }

      // Non-iterating: O(1) lookup from `fannedSlotsByElement` (pre-parsed,
      // includes phantom entries so no-material slots render as dashed
      // placeholders). Placeholders resolved against enhancedCtx.
      const elSlots = fannedSlotsByElement.get(el.id as string) ?? [];
      const info = {
        material: appearance.material,
        head: appearance.head,
        count: appearance.count,
        enchanted,
        ...(project ? previewItem(appearance, enhancedCtx, project, activeLang) : {}),
        elementId: el.id,
        multiPos: elSlots.length > 1,
        image: !!appearance.image,
      };
      for (const s of elSlots) {
        elementsByPosition.set(s.position, info);
      }
    }
  }

  const total = slotCount(type, menu.rows);
  const top = topPieceCrop(menu.rows);
  const bottom = bottomPieceCrop();
  const bottomY = bottomPieceY(menu.rows);
  const fullCrop = singleBackgroundCrop(type);

  return (
    <Group
      x={solo ? 0 : position.x}
      y={solo ? 0 : position.y}
      draggable={!solo}
      onDragStart={solo ? undefined : onMenuDragStart}
      onDragMove={solo ? undefined : nodeAlign.onDragMove}
      onDragEnd={solo ? undefined : onMenuDragEnd}
      // Selection stays active in solo too: sans ça, un clic sur un élément
      // condamnait la vue — plus rien ne permettait de re-sélectionner le menu.
      // Les clics slot font cancelBubble, donc seul le fond remonte ici.
      onClick={onClick}
      onTap={onClick}
      onDblClick={solo ? undefined : () => dispatchOpenElement(menu.id)}
      onDblTap={solo ? undefined : () => dispatchOpenElement(menu.id)}
      name={`menu:${menu.id}`}
      id={menu.id}
    >
      {/* Background. Chest uses two vanilla slices so its height adapts to
          `rows`; hopper/dropper use a single full-box crop. Images are
          listening=true so the menu Group has a hit shape and drag works from
          anywhere on the texture (Konva picks the deepest draggable, so filled
          slots still take precedence). */}
      {tex ? (
        single ? (
          <KonvaImage
            image={tex}
            x={0}
            y={0}
            width={fullCrop.width * TEX_SCALE}
            height={fullCrop.height * TEX_SCALE}
            crop={fullCrop}
            perfectDrawEnabled={false}
          />
        ) : (
          <>
            <KonvaImage
              image={tex}
              x={0}
              y={0}
              width={top.width * TEX_SCALE}
              height={top.height * TEX_SCALE}
              crop={top}
              perfectDrawEnabled={false}
            />
            <KonvaImage
              image={tex}
              x={0}
              y={bottomY}
              width={bottom.width * TEX_SCALE}
              height={bottom.height * TEX_SCALE}
              crop={bottom}
              perfectDrawEnabled={false}
            />
          </>
        )
      ) : (
        <Rect width={box.width} height={box.height} fill="#c6c6c6" perfectDrawEnabled={false} />
      )}
      {/* Selection halo */}
      {isSelected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke={brand}
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Edge-hover halo: gold border when this menu is the source of the hovered edge */}
      {hoveredEdge?.source === menu.id ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke={warning}
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Title bar — TitleRender draws all title layers (background + glyphs +
          text) faithfully, matching what the plugin emits in-game. Always
          interactive (v3): clicks on layers select them, clicks on the grey
          backdrop set this menu as the selected one (and clear any layer
          selection belonging to this menu). All wiring lives in TitleRender;
          no overlay Rect needed here. */}
      <TitleRender projectId={projectId} menuId={menu.id} scale={TEX_SCALE} />
      <ImageButtonsRender projectId={projectId} menu={menu} />
      <PlacementTray
        menu={menu}
        project={project}
        scope={sampleCtx}
        boxWidth={box.width}
        boxHeight={box.height}
      />
      {/* Slot interaction overlays */}
      {Array.from({ length: total }, (_, i) => {
        const { x, y } = slotXY(i, type);
        const el = elementsByPosition.get(i);
        if (el?.image) return null;
        const present = Boolean(el);
        const filled = Boolean(el?.material);
        const innerX = TEX_SLOT_INNER_OFFSET;
        const innerY = TEX_SLOT_INNER_OFFSET;
        const elementSelected = Boolean(
          el?.elementId && isElementSelected(selectedIds, selectionMenuId, el.elementId, menu.id),
        );
        const isFocusedSlot = elementSelected && focusedSlot === i;
        const isButtonMode = elementSelected && focusedSlot === null;
        const isEdgeTrigger = Boolean(edgeTriggerPositions?.has(i));
        // During selection drag, hide the SlotItem at the source's "sibling"
        // positions so the user only sees the offset ghost, not a stale copy
        // pinned at the original spot.
        const isSelectionSibling =
          dragState?.kind === "selection" &&
          i !== dragState.sourcePosition &&
          dragState.siblings.some((s) => s.position === i);
        return (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
            key={i}
            x={x}
            y={y}
            name={`slot:${menu.id}:${i}`}
            listening={present || armedForThisMenu}
            draggable={filled}
            onDragStart={
              filled && el?.elementId
                ? (e) => onSlotDragStart(e, i, el.elementId as ElementId)
                : undefined
            }
            onDragMove={filled ? onSlotDragMove : undefined}
            onClick={
              present || armedForThisMenu
                ? (e) => {
                    e.cancelBubble = true;
                    // Armed placement row: pin it at this slot on the current page.
                    if (armedForThisMenu && armedPlacement) {
                      pinPlacementRow({
                        projectId,
                        menuId: menu.id,
                        elementId: armedPlacement.elementId as ElementId,
                        key: armedPlacement.key,
                        position: i,
                      });
                      useUiStore.getState().setArmedPlacement(null);
                      return;
                    }
                    // Armed-from-Library: replace the material at this slot.
                    const armed = useUiStore.getState().armedMaterial;
                    if (armed) {
                      try {
                        useAccountStore.getState().setSlotMaterial({
                          projectId,
                          menuId: menu.id,
                          position: i,
                          material: armed,
                        });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "place failed");
                      }
                      return;
                    }
                    if (!el?.elementId) return;
                    const evt = e.evt as MouseEvent;
                    const sel = useSelectionStore.getState();
                    // Shift = additive multi-select (always button-mode for
                    // every member, since instance focus only makes sense on
                    // a single element).
                    if (evt.shiftKey) {
                      const next = new Set(sel.ids);
                      if (next.has(el.elementId)) next.delete(el.elementId);
                      else next.add(el.elementId);
                      sel.set(next, null);
                      return;
                    }
                    // Non-additive slot click → reveal the Edit tab so the
                    // selected element is immediately editable.
                    // Single-pos elements: button mode and instance mode
                    // would render identically (only one slot to outline),
                    // so the toggle is just visual noise. Always pick
                    // instance mode for consistency.
                    if (!el.multiPos) {
                      sel.set([el.elementId], i, menu.id);
                      return;
                    }
                    // Multi-pos: cmd/ctrl-click forces button mode.
                    // Otherwise first click = button mode; a follow-up
                    // click on any slot of the already-selected element
                    // narrows focus to that slot.
                    if (evt.metaKey || evt.ctrlKey) {
                      sel.set([el.elementId], null, menu.id);
                    } else if (sel.ids.has(el.elementId) && sel.ids.size === 1) {
                      sel.set([el.elementId], i, menu.id);
                    } else {
                      sel.set([el.elementId], null, menu.id);
                    }
                  }
                : undefined
            }
            onTap={
              present || armedForThisMenu
                ? (e) => {
                    e.cancelBubble = true;
                    if (armedForThisMenu && armedPlacement) {
                      pinPlacementRow({
                        projectId,
                        menuId: menu.id,
                        elementId: armedPlacement.elementId as ElementId,
                        key: armedPlacement.key,
                        position: i,
                      });
                      useUiStore.getState().setArmedPlacement(null);
                      return;
                    }
                    const armed = useUiStore.getState().armedMaterial;
                    if (armed) {
                      try {
                        useAccountStore.getState().setSlotMaterial({
                          projectId,
                          menuId: menu.id,
                          position: i,
                          material: armed,
                        });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "place failed");
                      }
                      return;
                    }
                    if (!el?.elementId) return;
                    const sel = useSelectionStore.getState();
                    if (!el.multiPos) {
                      sel.set([el.elementId], i, menu.id);
                      return;
                    }
                    if (sel.ids.has(el.elementId) && sel.ids.size === 1)
                      sel.set([el.elementId], i, menu.id);
                    else sel.set([el.elementId], null, menu.id);
                  }
                : undefined
            }
            onMouseEnter={
              present
                ? () => {
                    if (el?.elementId)
                      useHoverStore.getState().setElement(el.elementId as ElementId, i, menu.id);
                  }
                : undefined
            }
            onMouseLeave={
              present ? () => useHoverStore.getState().setElement(null, null) : undefined
            }
            onDragEnd={
              filled && el?.elementId
                ? (e) => onSlotDragEnd(e, i, el.elementId as ElementId)
                : undefined
            }
          >
            {filled && !isSelectionSibling
              ? (() => {
                  // `item:<id>` refs expand to the captured display (custom
                  // material / head texture); other refs pass through.
                  const d = project
                    ? resolveDisplayRef(project, el?.material ?? "")
                    : { material: el?.material ?? "" };
                  return (
                    <SlotItem
                      material={d.material}
                      head={el?.head ?? d.head}
                      innerX={innerX}
                      innerY={innerY}
                      count={el?.count}
                      enchanted={el?.enchanted || d.enchanted}
                    />
                  );
                })()
              : null}
            {present && !filled && !isSelectionSibling ? (
              <>
                {/* Transparent hit area so the group receives pointer events */}
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  fill="rgba(0,0,0,0.001)"
                  listening={true}
                  perfectDrawEnabled={false}
                />
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  stroke="rgba(255,255,255,0.45)"
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  cornerRadius={2}
                  fill="transparent"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </>
            ) : null}
            {/* Armed placement: empty slots become tap targets, highlighted so
                the user sees where the armed row will land. */}
            {armedForThisMenu && !present ? (
              <>
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  fill="rgba(0,0,0,0.001)"
                  listening={true}
                  perfectDrawEnabled={false}
                />
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  stroke={brand}
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  cornerRadius={2}
                  fill="transparent"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </>
            ) : null}
            {/* Selection outlines:
                  - button mode: every position outlined in solid blue
                  - instance mode: focused slot in emerald, siblings in blue
                    (so the user always sees the rest of the button) */}
            {elementSelected ? (
              <Rect
                x={innerX - 1}
                y={innerY - 1}
                width={TEX_SLOT_INNER + 2}
                height={TEX_SLOT_INNER + 2}
                stroke={isFocusedSlot ? brand : borderStrong}
                strokeWidth={isFocusedSlot || isButtonMode ? 2 : 1.5}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}
            {isEdgeTrigger ? (
              <Rect
                x={innerX - 2}
                y={innerY - 2}
                width={TEX_SLOT_INNER + 4}
                height={TEX_SLOT_INNER + 4}
                stroke={warning}
                strokeWidth={2}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}
          </Group>
        );
      })}
      {/* Alt-drag duplicate ghost (single drag only): a static copy of the
          source slot pinned at its original coordinates while the dragged
          Group follows the cursor. Without it, an Alt-drag looks like a
          move (the source disappears as the cursor copy follows). */}
      {dragState?.kind === "single" &&
      dragState.altKey &&
      elementsByPosition.get(dragState.sourcePosition)?.material
        ? (() => {
            const info = elementsByPosition.get(dragState.sourcePosition)!;
            const { x, y } = slotXY(dragState.sourcePosition, type);
            return (
              <Group x={x} y={y} listening={false} opacity={0.9}>
                <SlotItem
                  material={info.material!}
                  head={info.head}
                  innerX={TEX_SLOT_INNER_OFFSET}
                  innerY={TEX_SLOT_INNER_OFFSET}
                  count={info.count}
                />
              </Group>
            );
          })()
        : null}
      {/* Selection-drag ghosts: every other selected slot follows the dragged
          Group's offset so the user sees the whole selection translate. */}
      {dragState?.kind === "selection"
        ? dragState.siblings.map((sib) => {
            const { x, y } = slotXY(sib.position, type);
            return (
              <Group
                key={`ghost-${sib.position}`}
                x={x + dragState.offset.dx}
                y={y + dragState.offset.dy}
                listening={false}
                opacity={0.75}
              >
                <SlotItem
                  material={sib.material}
                  head={sib.head}
                  innerX={TEX_SLOT_INNER_OFFSET}
                  innerY={TEX_SLOT_INNER_OFFSET}
                  count={sib.count}
                />
              </Group>
            );
          })
        : null}
      {/* Pagination preview controls — one row per iterating element with
          overflow. Stacked below the menu's bottom edge so the menu's
          texture stays clean. Editor-only; not part of the runtime menu. */}
      {overflowing.map((info, ix) => (
        <PaginationControls
          key={info.elementId}
          y={box.height + 6 + ix * 22}
          width={box.width}
          page={info.page}
          totalPages={info.totalPages}
          onPrev={() => setPage(info.elementId, Math.max(0, info.page - 1))}
          onNext={() => setPage(info.elementId, Math.min(info.totalPages - 1, info.page + 1))}
        />
      ))}
      {/* DERNIER enfant volontairement : sa liste déroulante s'ouvre par-dessus
          le haut du menu, et dans Konva l'ordre de rendu EST l'ordre de
          priorité au clic. Rendu avant les slots, ses premières lignes étaient
          couvertes par eux — le clic les traversait et sélectionnait l'élément
          du dessous au lieu de choisir le contexte (2026-08-12). */}
      <PreviewContextBanner
        menu={menu}
        project={project}
        width={box.width}
        previewArgs={previewArgs}
      />
    </Group>
  );
}
