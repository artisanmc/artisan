import type { Menu, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import {
  COLS,
  GRID_PADDING,
  MENU_HEADER_HEIGHT,
  SLOT_SIZE,
  menuBoxSize,
  slotXY,
} from "./menuLayout";

interface MenuGroupProps {
  packId: PackId;
  menu: Menu;
  position: { x: number; y: number };
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
export function MenuGroup({ packId, menu, position }: MenuGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const box = menuBoxSize(menu.rows);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: menu.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, menu.id, setCanvasPosition],
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
    <Group x={position.x} y={position.y} draggable onDragEnd={onDragEnd} name={`menu:${menu.id}`}>
      <Rect
        width={box.width}
        height={box.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke="#3a3a3f"
        strokeWidth={1}
        perfectDrawEnabled={false}
      />
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
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
          <Group key={i} x={x} y={y} name={`slot:${menu.id}:${i}`} listening={false}>
            <Rect
              width={SLOT_SIZE}
              height={SLOT_SIZE}
              cornerRadius={3}
              fill={filled ? "#27272a" : "#18181b"}
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
              />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}

export const menuHeaderHeight = MENU_HEADER_HEIGHT;
