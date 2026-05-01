import type { ElementId, Menu, PackId } from "@/domain/types";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useEditingStore } from "@/state/editingStore";
import { useHoverStore } from "@/state/hoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useEffect, useState } from "react";
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
  const [vanillaTex] = useImage(TEX_URL);
  const [customTex] = useImage(customBgUrl ?? "");
  const usingCustom = Boolean(customBgUrl);

  const box = menuBoxSize(menu.rows);

  const onMenuDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const sourceEvent = e.evt;
      const cx = sourceEvent.clientX;
      const cy = sourceEvent.clientY;
      const minis = document.querySelectorAll<HTMLElement>("[data-pack-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
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
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(menu.id);
      else if (!ids.has(menu.id) || ids.size > 1) set([menu.id]);
    },
    [menu.id],
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
  // elements (e.g. positions: "0-8") render the same material in every cell;
  // any change to the element propagates to all of them automatically.
  const elementsByPosition = new Map<
    number,
    { material?: string; title?: string; count?: number; elementId: string }
  >();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.appearances[0];
      if (!appearance) continue;
      const info = {
        material: appearance.material,
        title: appearance.title,
        count: appearance.count,
        elementId: el.id,
      };
      for (const p of parsePositions(el.positions)) {
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
      {/* Title text in the texture's title bar — MiniMessage-aware so e.g.
          "<gold>Profil</gold>" actually renders gold. */}
      <MiniMessageKonvaText
        source={menu.title}
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
        const filled = Boolean(el?.material);
        const innerX = TEX_SLOT_INNER_OFFSET;
        const innerY = TEX_SLOT_INNER_OFFSET;
        const elementSelected = Boolean(el?.elementId && selectedIds.has(el.elementId));
        const isFocusedSlot = elementSelected && focusedSlot === i;
        const isButtonMode = elementSelected && focusedSlot === null;
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
            listening={filled}
            draggable={filled}
            onDragStart={
              filled && el?.elementId
                ? (e) => onSlotDragStart(e, i, el.elementId as ElementId)
                : undefined
            }
            onDragMove={filled ? onSlotDragMove : undefined}
            onClick={
              filled
                ? (e) => {
                    e.cancelBubble = true;
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
                    // Cmd/Ctrl-click is the explicit "back to button mode"
                    // shortcut. Otherwise: first click selects the whole
                    // button (focusedSlot null); a follow-up click on any
                    // slot of the already-selected element narrows focus to
                    // that slot.
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
              filled
                ? (e) => {
                    e.cancelBubble = true;
                    if (!el?.elementId) return;
                    const sel = useSelectionStore.getState();
                    if (sel.ids.has(el.elementId) && sel.ids.size === 1) sel.set([el.elementId], i);
                    else sel.set([el.elementId], null);
                  }
                : undefined
            }
            onMouseEnter={
              filled
                ? () => {
                    if (el?.elementId)
                      useHoverStore.getState().setElement(el.elementId as ElementId);
                  }
                : undefined
            }
            onMouseLeave={filled ? () => useHoverStore.getState().setElement(null) : undefined}
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
    </Group>
  );
}
