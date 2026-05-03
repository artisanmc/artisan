import type { ElementId, Menu, MenuId, PackId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { lookupPath, resolvePlaceholders } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useEditingStore } from "@/state/editingStore";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { toast } from "sonner";
import useImage from "use-image";
import { MiniMessageKonvaText } from "./MiniMessageKonvaText";
import { hitTestSlot } from "./hitTest";
import { itemTextureUrl } from "./itemTextures";
import {
  COLS,
  TEX_FIRST_SLOT_X,
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  TEX_SLOT_STRIDE,
  TEX_TITLE_H,
  TEX_URL,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  slotXY,
  topPieceCrop,
} from "./menuLayout";

/**
 * Coerce the string default value of a primitive ContextInput to its declared
 * type. Used to build a preview scope from contextInputs for the canvas.
 */
function coerceDefault(
  value: string | undefined,
  type: "player" | "string" | "integer" | "number" | "boolean",
): unknown {
  if (value === undefined || value === "") {
    switch (type) {
      case "player":
      case "string":
        return "";
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
    }
  }
  switch (type) {
    case "integer":
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === "true";
    case "player":
    case "string":
      return value;
  }
}

interface SlotItemProps {
  material: string;
  innerX: number;
  innerY: number;
  count?: number;
}

/**
 * Renders the visual content of a filled slot — vanilla MC item texture if
 * we have it bundled (most cases), or a small fallback Rect with the first 4
 * letters of the material name otherwise. The Rect is the slot Group's hit
 * shape; the Image draws on top of it so click/drag still register.
 *
 * Stack count (when > 1) is drawn bottom-right with a dark drop shadow,
 * matching the vanilla MC tooltip look.
 */
function SlotItem({ material, innerX, innerY, count }: SlotItemProps) {
  const url = itemTextureUrl(material);
  const [image] = useImage(url ?? "");
  const showCount = (count ?? 0) > 1;
  const countText = String(count ?? 0);
  const countFontSize = 7 * TEX_SCALE;
  return (
    <>
      {/* Backdrop Rect — also acts as the slot Group's hit shape. */}
      <Rect
        x={innerX}
        y={innerY}
        width={TEX_SLOT_INNER}
        height={TEX_SLOT_INNER}
        fill={url ? "transparent" : "rgba(20,20,20,0.55)"}
        cornerRadius={2}
        perfectDrawEnabled={false}
      />
      {url && image ? (
        <KonvaImage
          image={image}
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <Text
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          text={material.slice(0, 4)}
          fontFamily="ui-monospace, monospace"
          fontSize={6 * TEX_SCALE}
          fill="#fafafa"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      )}
      {showCount && (
        <>
          {/* Drop shadow — same offset as vanilla's 1px shadow at our 2× scale. */}
          <Text
            x={innerX + TEX_SCALE}
            y={innerY + TEX_SLOT_INNER - countFontSize - TEX_SCALE + TEX_SCALE}
            width={TEX_SLOT_INNER}
            height={countFontSize}
            text={countText}
            fontFamily="ui-monospace, monospace"
            fontSize={countFontSize}
            fontStyle="bold"
            fill="#3f3f3f"
            align="right"
            listening={false}
          />
          <Text
            x={innerX}
            y={innerY + TEX_SLOT_INNER - countFontSize - TEX_SCALE}
            width={TEX_SLOT_INNER}
            height={countFontSize}
            text={countText}
            fontFamily="ui-monospace, monospace"
            fontSize={countFontSize}
            fontStyle="bold"
            fill="#ffffff"
            align="right"
            listening={false}
          />
        </>
      )}
    </>
  );
}

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
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(menu.id));
  const selectedIds = useSelectionStore((s) => s.ids);
  const focusedSlot = useSelectionStore((s) => s.focusedSlot);
  const customBgUrl = useAccountStore((s) => {
    if (!menu.background) return undefined;
    const pack = s.account.packs.find((p) => p.id === packId);
    return pack?.assets.find((a) => a.id === menu.background!.assetId)?.url;
  });
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
  const [customTex] = useImage(customBgUrl ?? "");
  const usingCustom = Boolean(customBgUrl);

  const box = menuBoxSize(menu.rows);

  const onMenuDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // TouchEvent has no clientX/Y — those live on changedTouches[0]. Without
      // this branching the rect-check below short-circuits to "all conditions
      // false" on touch, and the first pack-mini in the DOM (often hidden
      // ones from the desktop sidebar) receives the menu by accident.
      const evt = e.evt as unknown as MouseEvent & TouchEvent;
      let cx: number;
      let cy: number;
      if (typeof evt.clientX === "number" && Number.isFinite(evt.clientX)) {
        cx = evt.clientX;
        cy = evt.clientY;
      } else if (evt.changedTouches?.[0]) {
        cx = evt.changedTouches[0].clientX;
        cy = evt.changedTouches[0].clientY;
      } else {
        // No pointer info — just persist the new position in this pack.
        setCanvasPosition({ packId, nodeId: menu.id, x: e.target.x(), y: e.target.y() });
        return;
      }

      const minis = document.querySelectorAll<HTMLElement>("[data-pack-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
        // Skip elements that are display:none / detached (zero rect).
        if (rect.width === 0 && rect.height === 0) continue;
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        const targetPackId = m.getAttribute("data-pack-id") as PackId | null;
        if (!targetPackId || targetPackId === packId) continue;
        e.target.position({ x: position.x, y: position.y });
        try {
          useAccountStore
            .getState()
            .moveMenuToPack({ menuId: menu.id, fromPackId: packId, toPackId: targetPackId });
          toast.success(`Moved ${menu.id} to ${targetPackId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "move failed");
        }
        return;
      }
      setCanvasPosition({ packId, nodeId: menu.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, menu.id, position.x, position.y, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;

      // Touch/desktop tap-to-place: if a Library item is "armed", clicking
      // anywhere on this menu places it at the slot under the pointer (if
      // any) instead of selecting the menu. Skip if no slot is hit so a tap
      // on the title bar still selects.
      const armed = useUiStore.getState().armedMaterial;
      if (armed) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer && stage) {
          const world = {
            x: (pointer.x - stage.x()) / stage.scaleX(),
            y: (pointer.y - stage.y()) / stage.scaleY(),
          };
          const account = useAccountStore.getState().account;
          const pack = account.packs.find((p) => p.id === packId);
          if (pack) {
            const hit = hitTestSlot(pack, layout, world.x, world.y);
            if (hit && hit.menuId === menu.id) {
              try {
                useAccountStore.getState().setSlotMaterial({
                  packId,
                  menuId: hit.menuId as MenuId,
                  position: hit.position,
                  material: armed,
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "place failed");
              }
              return;
            }
          }
        }
      }

      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(menu.id);
      else if (!ids.has(menu.id) || ids.size > 1) set([menu.id]);
    },
    [menu.id, packId, layout],
  );

  const onTitleDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      useEditingStore.getState().setEditing(menu.id);
    },
    [menu.id],
  );

  /**
   * Slot-drag state. Two flavours:
   *   - single   : moves/duplicates one position of one element. Alt-drag
   *                  shows a static copy at the source while the cursor
   *                  follows the cursor copy.
   *   - selection: shifts every position of every element in the current
   *                  selection by a grid delta. Triggered when the dragged
   *                  slot's element is part of a multi-element selection,
   *                  OR when a single multi-pos element is selected in
   *                  button mode (focusedSlot null). Ghost copies of every
   *                  other selected slot follow the drag offset.
   */
  type SiblingGhost = { position: number; material: string; count?: number };
  type DragState =
    | null
    | { kind: "single"; sourcePosition: number; altKey: boolean }
    | {
        kind: "selection";
        sourcePosition: number;
        elementIds: ElementId[];
        siblings: SiblingGhost[];
        offset: { dx: number; dy: number };
        altKey: boolean;
      };
  const [dragState, setDragState] = useState<DragState>(null);

  // Watch Alt key changes while a slot is being dragged; mousemove also
  // refreshes altKey via dragmove, but key events catch presses while idle.
  const isDragging = dragState !== null;
  useEffect(() => {
    if (!isDragging) return;
    const sync = (e: KeyboardEvent) => {
      setDragState((prev) => {
        if (!prev || prev.altKey === e.altKey) return prev;
        return { ...prev, altKey: e.altKey };
      });
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, [isDragging]);

  const onSlotDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, position: number, sourceElementId: ElementId) => {
      e.target.getParent()?.moveToTop();
      e.target.moveToTop();
      const altKey = (e.evt as MouseEvent).altKey;
      const sel = useSelectionStore.getState();
      const sourceInSelection = sel.ids.has(sourceElementId);

      // Look up the source element's positions to decide between single
      // and selection drag. Selection drag is only meaningful when the
      // user actually has multiple slots that should move together.
      let sourcePosCount = 0;
      if (sourceInSelection) {
        outer: for (const layer of menu.layers) {
          for (const el of layer.elements) {
            if (el.id === sourceElementId) {
              sourcePosCount = parsePositions(el.positions).length;
              break outer;
            }
          }
        }
      }
      const useSelectionDrag =
        sourceInSelection && (sel.ids.size > 1 || (sel.focusedSlot === null && sourcePosCount > 1));

      if (useSelectionDrag) {
        // Capture every "non-source" slot that should ghost-follow the drag.
        const siblings: SiblingGhost[] = [];
        for (const layer of menu.layers) {
          for (const el of layer.elements) {
            if (!sel.ids.has(el.id)) continue;
            const appearance = el.appearances[0];
            if (!appearance?.material) continue;
            for (const p of parsePositions(el.positions)) {
              if (p === position) continue;
              siblings.push({
                position: p,
                material: appearance.material,
                count: appearance.count,
              });
            }
          }
        }
        setDragState({
          kind: "selection",
          sourcePosition: position,
          elementIds: [...sel.ids] as ElementId[],
          siblings,
          offset: { dx: 0, dy: 0 },
          altKey,
        });
      } else {
        setDragState({ kind: "single", sourcePosition: position, altKey });
      }
    },
    [menu.layers],
  );

  const onSlotDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const altKey = (e.evt as MouseEvent).altKey;
    const node = e.target;
    setDragState((prev) => {
      if (!prev) return prev;
      if (prev.kind === "selection") {
        const origin = slotXY(prev.sourcePosition);
        const dx = node.x() - origin.x;
        const dy = node.y() - origin.y;
        if (prev.offset.dx === dx && prev.offset.dy === dy && prev.altKey === altKey) return prev;
        return { ...prev, offset: { dx, dy }, altKey };
      }
      if (prev.altKey === altKey) return prev;
      return { ...prev, altKey };
    });
  }, []);

  /**
   * Slot drag-end router. Two paths depending on the captured drag state:
   *
   * Selection drag (multi-element OR single-element button mode):
   *   - Compute grid delta from the dragged Group's offset
   *   - Dispatch moveSelectionByDelta to shift every position of every
   *     selected element together
   *
   * Single drag:
   *   - drop outside any menu          → clear this position
   *   - drop on another slot, no Alt   → move this position within source
   *   - drop on another slot, Alt held → duplicate (add target to source)
   *   - drop on a slot already owned   → no-op
   */
  const onSlotDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, srcPosition: number, sourceElementId: ElementId) => {
      e.cancelBubble = true;
      const captured = dragState;
      setDragState(null);
      const node = e.target;
      const localX = node.x();
      const localY = node.y();
      const original = slotXY(srcPosition);
      node.position({ x: original.x, y: original.y });

      const worldX = position.x + localX + TEX_SLOT_STRIDE / 2;
      const worldY = position.y + localY + TEX_SLOT_STRIDE / 2;
      const account = useAccountStore.getState().account;
      const pack = account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const hit = hitTestSlot(pack, layout, worldX, worldY);
      const altKey = (e.evt as MouseEvent).altKey;

      // Selection-drag: shift the whole selection by the grid delta resolved
      // through hitTestSlot so the drop target depends on cursor position
      // rather than where the user grabbed inside the slot.
      if (captured?.kind === "selection") {
        if (!hit || hit.menuId !== menu.id) return;
        const dCol = (hit.position % 9) - (srcPosition % 9);
        const dRow = Math.floor(hit.position / 9) - Math.floor(srcPosition / 9);
        if (dCol === 0 && dRow === 0) return;
        try {
          useAccountStore.getState().moveSelectionByDelta({
            packId,
            menuId: menu.id,
            elementIds: captured.elementIds,
            dCol,
            dRow,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "selection drag failed");
        }
        return;
      }

      try {
        if (!hit || hit.menuId !== menu.id) {
          useAccountStore.getState().clearSlot({
            packId,
            menuId: menu.id,
            position: srcPosition,
          });
          return;
        }

        if (hit.position === srcPosition) return;

        if (altKey) {
          useAccountStore.getState().addElementPosition({
            packId,
            menuId: menu.id,
            elementId: sourceElementId,
            position: hit.position,
          });
        } else {
          useAccountStore.getState().moveElementPosition({
            packId,
            menuId: menu.id,
            elementId: sourceElementId,
            fromPosition: srcPosition,
            toPosition: hit.position,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "slot drag failed");
      }
    },
    [dragState, packId, menu.id, position.x, position.y, layout],
  );

  // Fan out each element across every slot it occupies. Multi-position
  // elements (e.g. positions: "0-8") render the same material in every cell.
  // For elements with `iterates`, we *unroll* across positions: each position
  // i binds the i-th item from the preview scope and resolves placeholders
  // in material/title/count against that item-scoped context. Excess
  // positions (more positions than items) stay empty.
  // Build a preview scope from contextInputs.
  //  - primitive: coerce default to its declared type
  //  - sourceRef: skipped for C1 (full resolution comes in C2)
  const sampleCtx: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      sampleCtx[input.name] = coerceDefault(input.default, input.type);
    }
    // sourceRef inputs not yet resolved — preview shows them as undefined
  }
  // Active language + pack ref so we can resolve `LText` refs (menu
  // title, appearance titles, lore lines) into the actually-displayed
  // string. Pack ref is stable thanks to immer; the resolver reads
  // `pack.i18nKeys[lt.key][activeLang]` with fallback to defaultLang.
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
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
      const positions = parsePositions(el.positions);

      if (el.iterates) {
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
              ? resolvePlaceholders(appearance.material, enhancedCtx)
              : undefined,
            title: titleRaw ? resolvePlaceholders(titleRaw, enhancedCtx) : undefined,
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
              ? resolvePlaceholders(appearance.material, itemCtx)
              : undefined,
            title: titleRaw ? resolvePlaceholders(titleRaw, itemCtx) : undefined,
            count: appearance.count,
            elementId: el.id,
            multiPos: false,
          });
        }
        continue;
      }

      // Non-iterating: still resolve placeholders against enhancedCtx so
      // `{player}`, `{pagination.page}`, etc. show preview values.
      const titleRaw = pack ? getText(pack, appearance.title, activeLang) : "";
      const info = {
        material: appearance.material
          ? resolvePlaceholders(appearance.material, enhancedCtx)
          : undefined,
        title: titleRaw ? resolvePlaceholders(titleRaw, enhancedCtx) : undefined,
        count: appearance.count,
        elementId: el.id,
        multiPos: positions.length > 1,
      };
      for (const p of positions) {
        elementsByPosition.set(p, info);
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
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      name={`menu:${menu.id}`}
      id={menu.id}
    >
      {/* Background. Custom upload covers the full menu box; vanilla mode
          renders two slices so the chest height adapts to `rows`.
          Images are listening=true so the menu Group has a hit shape and
          drag works from anywhere on the texture (Konva picks the deepest
          draggable, so filled slots still take precedence). */}
      {usingCustom && customTex ? (
        <KonvaImage
          image={customTex}
          x={0}
          y={0}
          width={box.width}
          height={box.height}
          perfectDrawEnabled={false}
        />
      ) : vanillaTex ? (
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
          stroke="#22c55e"
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Edge-hover halo: amber border when this menu is the source of the hovered edge */}
      {hoveredEdge?.source === menu.id ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke="#f59e0b"
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Title text in the texture's title bar — MiniMessage-aware so e.g.
          "<gold>Profil</gold>" actually renders gold. Resolved against
          enhancedCtx so users can write `<gold>Page {pagination.page}/
          {pagination.totalPages}</gold>` or interpolate any sample-context
          field directly into the title. */}
      <MiniMessageKonvaText
        source={resolvePlaceholders(pack ? getText(pack, menu.title, activeLang) : "", enhancedCtx)}
        x={TEX_FIRST_SLOT_X + 1}
        y={5 * TEX_SCALE}
        fontSize={7 * TEX_SCALE}
        defaultColor="#404040"
      />
      {/* Interactive title-bar overlay: dblclicking it opens the inline title
          editor. Constrained to the title row only so dblclicks elsewhere on
          the menu (e.g. on a slot) don't accidentally open the editor at the
          wrong target. Single click bubbles through to select the menu. */}
      <Rect
        x={0}
        y={0}
        width={box.width}
        height={TEX_TITLE_H}
        fill="transparent"
        onDblClick={onTitleDblClick}
        onDblTap={onTitleDblClick}
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
                stroke={isFocusedSlot ? "#22c55e" : "#3b82f6"}
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
                stroke="#f59e0b"
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

interface PaginationControlsProps {
  y: number;
  width: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Editor-only Konva pagination row rendered beneath a menu when an
 * iterating element's source list overflows its position count. Lets the
 * user step through pages of sample data without touching the JSON.
 */
function PaginationControls({
  y,
  width,
  page,
  totalPages,
  onPrev,
  onNext,
}: PaginationControlsProps) {
  const btnW = 28;
  const btnH = 18;
  const labelW = width - btnW * 2 - 8;
  const fontSize = 10;
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;
  return (
    <Group y={y}>
      <Group
        x={0}
        listening={canPrev}
        opacity={canPrev ? 1 : 0.4}
        onClick={canPrev ? onPrev : undefined}
        onTap={canPrev ? onPrev : undefined}
      >
        <Rect width={btnW} height={btnH} fill="#27272a" cornerRadius={3} />
        <Text
          x={0}
          y={0}
          width={btnW}
          height={btnH}
          text="◀"
          fontSize={fontSize}
          fill="#a1a1aa"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
      <Rect x={btnW + 4} width={labelW} height={btnH} fill="#18181b" cornerRadius={3} />
      <Text
        x={btnW + 4}
        y={0}
        width={labelW}
        height={btnH}
        text={`Page ${page + 1} / ${totalPages}`}
        fontSize={fontSize}
        fill="#a1a1aa"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
      <Group
        x={btnW + 4 + labelW + 4}
        listening={canNext}
        opacity={canNext ? 1 : 0.4}
        onClick={canNext ? onNext : undefined}
        onTap={canNext ? onNext : undefined}
      >
        <Rect width={btnW} height={btnH} fill="#27272a" cornerRadius={3} />
        <Text
          x={0}
          y={0}
          width={btnW}
          height={btnH}
          text="▶"
          fontSize={fontSize}
          fill="#a1a1aa"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    </Group>
  );
}
