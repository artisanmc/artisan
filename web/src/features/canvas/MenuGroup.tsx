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

export function MenuGroup({ packId, menu, position }: MenuGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const box = menuBoxSize(menu.rows);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: menu.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, menu.id, setCanvasPosition],
  );

  // Flatten all elements across layers, indexed by position string.
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
        shadowColor="#000"
        shadowOpacity={0.4}
        shadowBlur={6}
        shadowOffsetY={2}
      />
      <Text
        x={GRID_PADDING}
        y={GRID_PADDING}
        text={menu.title}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#e5e5e5"
      />
      <Text
        x={GRID_PADDING}
        y={GRID_PADDING + 12}
        text={`${menu.id} · ${menu.rows}×${COLS}`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
      />
      {Array.from({ length: slotCount }, (_, i) => {
        const { x, y } = slotXY(i);
        const el = elementsByPosition.get(String(i));
        const filled = Boolean(el?.material);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
          <Group key={i} x={x} y={y} name={`slot:${menu.id}:${i}`}>
            <Rect
              width={SLOT_SIZE}
              height={SLOT_SIZE}
              cornerRadius={3}
              fill={filled ? "#27272a" : "#18181b"}
              stroke={filled ? "#52525b" : "#27272a"}
              strokeWidth={1}
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
