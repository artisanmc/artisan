import type { Menu, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEditingStore } from "@/state/editingStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { toast } from "sonner";
import { BackgroundImage } from "./BackgroundImage";
import { hitTestSlot } from "./hitTest";
import {
  COLS,
  GRID_PADDING,
  MENU_HEADER_HEIGHT,
  SLOT_GAP,
  SLOT_SIZE,
  menuBoxSize,
  slotXY,
} from "./menuLayout";

interface MenuGroupProps {
  packId: PackId;
  menu: Menu;
  position: { x: number; y: number };
  /** Full pack-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
}

/**
 * Perf notes:
 * - No Canvas2D shadows (they force an offscreen buffer per shape; with ~200
 *   nodes per menu × N menus that tanks the drag frame rate). The 1px stroke
 *   provides enough definition.
 * - perfectDrawEnabled={false} on every Rect: skips the precise stroke/fill
 *   double-pass that's irrelevant at our visual fidelity.
 * - listening={false} on slot Rects/Text and the header/title Text: drag
 *   targets ride on the parent Group; per-slot interactivity is opt-in
 *   (Task 6 will flip slots back to listening for palette drop hit-testing).
 */
export function MenuGroup({ packId, menu, position, layout }: MenuGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(menu.id));
  const backgroundUrl = useAccountStore((s) => {
    if (!menu.background) return undefined;
    const pack = s.account.packs.find((p) => p.id === packId);
    return pack?.assets.find((a) => a.id === menu.background!.assetId)?.url;
  });
  const box = menuBoxSize(menu.rows);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // Cross-pack drop: if the drag ends with the cursor over a pack mini in
      // the sidebar, route to moveMenuToPack instead of saving the position.
      const sourceEvent = e.evt;
      const cx = sourceEvent.clientX;
      const cy = sourceEvent.clientY;
      const minis = document.querySelectorAll<HTMLElement>("[data-pack-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        const targetPackId = m.getAttribute("data-pack-id") as PackId | null;
        if (!targetPackId || targetPackId === packId) continue;
        // Reset Konva node back to original position so the source pack
        // doesn't pick up a stale offset before the move clears the menu.
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

  const onDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      useEditingStore.getState().setEditing(menu.id);
    },
    [menu.id],
  );

  /**
   * Slot drag-out router: drop outside any menu → clear; drop on another slot
   * → move (set destination, clear source). Self-drop is a no-op. Always
   * resets the dragged Konva node back to its layout XY so the visual returns
   * even when the data didn't change.
   */
  const onSlotDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, srcPosition: number, material: string) => {
      e.cancelBubble = true;
      const node = e.target;
      // Compute drop point in pack-canvas world coords. The slot Group's final
      // x/y is in menu-local space; we need world = menu position + local.
      const localX = node.x();
      const localY = node.y();
      // Reset visual immediately so any data outcome aligns with what user sees.
      const original = slotXY(srcPosition);
      node.position({ x: original.x, y: original.y });

      const worldX = position.x + localX + SLOT_SIZE / 2;
      const worldY = position.y + localY + SLOT_SIZE / 2;
      const account = useAccountStore.getState().account;
      const pack = account.packs.find((p) => p.id === packId);
      if (!pack) return;

      const hit = hitTestSlot(pack, layout, worldX, worldY);

      if (hit && hit.menuId === menu.id && hit.position === srcPosition) return; // self-drop

      try {
        if (!hit) {
          // Outside any menu → clear source.
          useAccountStore.getState().clearSlot({
            packId,
            menuId: menu.id,
            position: srcPosition,
          });
        } else {
          // Move: set target material, then clear source.
          useAccountStore.getState().setSlotMaterial({
            packId,
            menuId: hit.menuId as MenuId,
            position: hit.position,
            material,
          });
          useAccountStore.getState().clearSlot({
            packId,
            menuId: menu.id,
            position: srcPosition,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "slot drag failed");
      }
    },
    [packId, menu.id, position.x, position.y, layout],
  );

  const elementsByPosition = new Map<string, { material?: string; title?: string }>();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.appearances[0];
      if (!appearance) continue;
      elementsByPosition.set(el.positions, {
        material: appearance.material,
        title: appearance.title,
      });
    }
  }

  const slotCount = menu.rows * COLS;

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      name={`menu:${menu.id}`}
      id={menu.id}
    >
      <Rect
        width={box.width}
        height={box.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke={isSelected ? "#22c55e" : "#3a3a3f"}
        strokeWidth={isSelected ? 2 : 1}
        perfectDrawEnabled={false}
      />
      {backgroundUrl ? (
        <BackgroundImage
          url={backgroundUrl}
          x={GRID_PADDING}
          y={GRID_PADDING + MENU_HEADER_HEIGHT}
          width={COLS * SLOT_SIZE + (COLS - 1) * SLOT_GAP}
          height={menu.rows * SLOT_SIZE + (menu.rows - 1) * SLOT_GAP}
        />
      ) : null}
      <Text
        x={GRID_PADDING}
        y={GRID_PADDING}
        text={menu.title}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#e5e5e5"
        listening={false}
      />
      <Text
        x={GRID_PADDING}
        y={GRID_PADDING + 12}
        text={`${menu.id} · ${menu.rows}×${COLS}`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
      {Array.from({ length: slotCount }, (_, i) => {
        const { x, y } = slotXY(i);
        const el = elementsByPosition.get(String(i));
        const filled = Boolean(el?.material);
        // Filled slots are listening + draggable so they can be dragged out
        // (drop outside any menu → clear, drop on another slot → move).
        // Empty slots stay non-interactive so menu drag still picks up gap clicks.
        return (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
            key={i}
            x={x}
            y={y}
            name={`slot:${menu.id}:${i}`}
            listening={filled}
            draggable={filled}
            onDragEnd={
              filled && el?.material ? (e) => onSlotDragEnd(e, i, el.material!) : undefined
            }
          >
            <Rect
              width={SLOT_SIZE}
              height={SLOT_SIZE}
              cornerRadius={3}
              fill={filled ? "#27272a" : backgroundUrl ? "rgba(0,0,0,0.25)" : "#18181b"}
              stroke={filled ? "#52525b" : "#27272a"}
              strokeWidth={1}
              perfectDrawEnabled={false}
            />
            {el?.material ? (
              <Text
                width={SLOT_SIZE}
                height={SLOT_SIZE}
                text={el.material.slice(0, 4)}
                fontFamily="ui-monospace, monospace"
                fontSize={8}
                fill="#d4d4d8"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}

export const menuHeaderHeight = MENU_HEADER_HEIGHT;
