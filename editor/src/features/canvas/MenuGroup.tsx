import type { ElementId, Menu, MenuId, PackId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useMemo } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { toast } from "sonner";
import useImage from "use-image";
import { hitTestSlot } from "./hitTest";
import { fanoutElements, type SlotEntry } from "./menuFanout";
import { PaginationControls } from "./PaginationControls";
import { useMenuClick } from "./useMenuClick";
import { useMenuDrag } from "./useMenuDrag";
import { useSlotDrag } from "./useSlotDrag";
import { SlotItem } from "./SlotItem";
import { TitleRender } from "./title/composer/TitleRender";
import {
  COLS,
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  TEX_SLOT_STRIDE,
  TEX_URL,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  slotXY,
  topPieceCrop,
} from "./menuLayout";
import { buildPreviewScope, renderPreview } from "./menuPreviewScope";

interface MenuGroupProps {
  packId: PackId;
  menu: Menu;
  position: { x: number; y: number };
  /** Full pack-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
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
export function MenuGroup({ packId, menu, position, layout }: MenuGroupProps) {
  const isSelected = useSelectionStore((s) => s.ids.has(menu.id));
  const selectedIds = useSelectionStore((s) => s.ids);
  const focusedSlot = useSelectionStore((s) => s.focusedSlot);
  const hoveredEdge = useEdgeHoverStore((s) => s.edge);
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

  const [vanillaTex] = useImage(TEX_URL);

  const box = menuBoxSize(menu.rows);

  const { onMenuDragStart, onMenuDragEnd } = useMenuDrag({ packId, menuId: menu.id, position });

  const { onClick } = useMenuClick({ packId, menu, layout });

  const { dragState, onSlotDragStart, onSlotDragMove, onSlotDragEnd } = useSlotDrag({
    packId,
    menuId: menu.id,
    position,
    layout,
    menuLayers: menu.layers,
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

  // Active language + pack ref so we can resolve `LText` refs (menu
  // title, appearance titles, lore lines) into the actually-displayed
  // string. Pack ref is stable thanks to immer; the resolver reads
  // `pack.i18nKeys[lt.key][activeLang]` with fallback to defaultLang.
  // For `iterates` elements, positions are unrolled against the preview
  // scope; each position i binds the i-th item with placeholder resolution.
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  // Build a preview scope from contextInputs — primitives are coerced to their
  // declared type; sourceRefs are resolved against pack.dataSources /
  // pack.importedConnectors (Plan C4).
  const sampleCtx = pack ? buildPreviewScope(menu, pack) : {};
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
      if (!el.iterates) continue;
      const appearance = el.appearances[0];
      if (!appearance) continue;
      const positions = parsePositions(el.positions);
      const list = lookupPath(sampleCtx, el.iterates.source);
      const items = Array.isArray(list) ? list : [];
      const perPage = Math.max(1, positions.length);
      const totalPages = Math.max(1, Math.ceil(items.length / perPage));
      const rawPage = pageByElement[el.id] ?? 0;
      const page = Math.min(Math.max(0, rawPage), totalPages - 1);
      const entry = { page: page + 1, totalPages };
      paginationCtx[el.iterates.source] = entry;
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
    { material?: string; title?: string; count?: number; elementId: string; multiPos: boolean }
  >();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.appearances[0];
      if (!appearance) continue;

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
          const titleRaw = pack ? getText(pack, appearance.title, activeLang) : "";
          elementsByPosition.set(positions[0]!, {
            material: appearance.material
              ? pack ? renderPreview(appearance.material, enhancedCtx, pack, activeLang) : appearance.material
              : undefined,
            title: titleRaw && pack ? renderPreview(titleRaw, enhancedCtx, pack, activeLang) : titleRaw || undefined,
            count: appearance.count,
            elementId: el.id,
            multiPos: false,
          });
          continue;
        }

        for (let i = 0; i < perPage && offset + i < items.length; i++) {
          const item = items[offset + i];
          const itemCtx = { ...enhancedCtx, [el.iterates.alias]: item };
          const titleRaw = pack ? getText(pack, appearance.title, activeLang) : "";
          elementsByPosition.set(positions[i]!, {
            material: appearance.material
              ? pack ? renderPreview(appearance.material, itemCtx, pack, activeLang) : appearance.material
              : undefined,
            title: titleRaw && pack ? renderPreview(titleRaw, itemCtx, pack, activeLang) : titleRaw || undefined,
            count: appearance.count,
            elementId: el.id,
            multiPos: false,
          });
        }
        continue;
      }

      // Non-iterating: O(1) lookup from `fannedSlotsByElement` (pre-parsed,
      // includes phantom entries so no-material slots render as dashed
      // placeholders). Placeholders resolved against enhancedCtx.
      const elSlots = fannedSlotsByElement.get(el.id as string) ?? [];
      const titleRaw = pack ? getText(pack, appearance.title, activeLang) : "";
      const info = {
        material: appearance.material
          ? pack ? renderPreview(appearance.material, enhancedCtx, pack, activeLang) : appearance.material
          : undefined,
        title: titleRaw && pack ? renderPreview(titleRaw, enhancedCtx, pack, activeLang) : titleRaw || undefined,
        count: appearance.count,
        elementId: el.id,
        multiPos: elSlots.length > 1,
      };
      for (const s of elSlots) {
        elementsByPosition.set(s.position, info);
      }
    }
  }

  const slotCount = menu.rows * COLS;
  const top = topPieceCrop(menu.rows);
  const bottom = bottomPieceCrop();
  const bottomY = bottomPieceY(menu.rows);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={onMenuDragStart}
      onDragEnd={onMenuDragEnd}
      onClick={onClick}
      onTap={onClick}
      name={`menu:${menu.id}`}
      id={menu.id}
    >
      {/* Background. Two vanilla slices so the chest height adapts to `rows`.
          Images are listening=true so the menu Group has a hit shape and
          drag works from anywhere on the texture (Konva picks the deepest
          draggable, so filled slots still take precedence). */}
      {vanillaTex ? (
        <>
          <KonvaImage
            image={vanillaTex}
            x={0}
            y={0}
            width={top.width * TEX_SCALE}
            height={top.height * TEX_SCALE}
            crop={top}
            perfectDrawEnabled={false}
          />
          <KonvaImage
            image={vanillaTex}
            x={0}
            y={bottomY}
            width={bottom.width * TEX_SCALE}
            height={bottom.height * TEX_SCALE}
            crop={bottom}
            perfectDrawEnabled={false}
          />
        </>
      ) : (
        <Rect width={box.width} height={box.height} fill="#c6c6c6" perfectDrawEnabled={false} />
      )}
      {/* Selection halo */}
      {isSelected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke="#DF6B41"
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
          stroke="#E2A85A"
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
      <TitleRender
        packId={packId}
        menuId={menu.id}
        scale={TEX_SCALE}
      />
      {/* Slot interaction overlays */}
      {Array.from({ length: slotCount }, (_, i) => {
        const { x, y } = slotXY(i);
        const el = elementsByPosition.get(i);
        const present = Boolean(el);
        const filled = Boolean(el?.material);
        const innerX = TEX_SLOT_INNER_OFFSET;
        const innerY = TEX_SLOT_INNER_OFFSET;
        const elementSelected = Boolean(el?.elementId && selectedIds.has(el.elementId));
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
            listening={present}
            draggable={filled}
            onDragStart={
              filled && el?.elementId
                ? (e) => onSlotDragStart(e, i, el.elementId as ElementId)
                : undefined
            }
            onDragMove={filled ? onSlotDragMove : undefined}
            onClick={
              present
                ? (e) => {
                    e.cancelBubble = true;
                    // Armed-from-Library: replace the material at this slot.
                    const armed = useUiStore.getState().armedMaterial;
                    if (armed) {
                      try {
                        useAccountStore.getState().setSlotMaterial({
                          packId,
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
                    // Single-pos elements: button mode and instance mode
                    // would render identically (only one slot to outline),
                    // so the toggle is just visual noise. Always pick
                    // instance mode for consistency.
                    if (!el.multiPos) {
                      sel.set([el.elementId], i);
                      return;
                    }
                    // Multi-pos: cmd/ctrl-click forces button mode.
                    // Otherwise first click = button mode; a follow-up
                    // click on any slot of the already-selected element
                    // narrows focus to that slot.
                    if (evt.metaKey || evt.ctrlKey) {
                      sel.set([el.elementId], null);
                    } else if (sel.ids.has(el.elementId) && sel.ids.size === 1) {
                      sel.set([el.elementId], i);
                    } else {
                      sel.set([el.elementId], null);
                    }
                  }
                : undefined
            }
            onTap={
              present
                ? (e) => {
                    e.cancelBubble = true;
                    const armed = useUiStore.getState().armedMaterial;
                    if (armed) {
                      try {
                        useAccountStore.getState().setSlotMaterial({
                          packId,
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
                      sel.set([el.elementId], i);
                      return;
                    }
                    if (sel.ids.has(el.elementId) && sel.ids.size === 1) sel.set([el.elementId], i);
                    else sel.set([el.elementId], null);
                  }
                : undefined
            }
            onMouseEnter={
              present
                ? () => {
                    if (el?.elementId)
                      useHoverStore.getState().setElement(el.elementId as ElementId, i);
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
            {filled && !isSelectionSibling ? (
              <SlotItem
                material={el?.material ?? ""}
                innerX={innerX}
                innerY={innerY}
                count={el?.count}
              />
            ) : null}
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
                stroke={isFocusedSlot ? "#DF6B41" : "#F0DDB8"}
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
                stroke="#E2A85A"
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
            const { x, y } = slotXY(dragState.sourcePosition);
            return (
              <Group x={x} y={y} listening={false} opacity={0.9}>
                <SlotItem
                  material={info.material!}
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
            const { x, y } = slotXY(sib.position);
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
    </Group>
  );
}
