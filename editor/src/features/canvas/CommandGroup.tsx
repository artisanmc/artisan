import type { Command, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { COMMAND_BOX } from "./menuLayout";

interface CommandGroupProps {
  packId: PackId;
  command: Command;
  position: { x: number; y: number };
}

export function CommandGroup({ packId, command, position }: CommandGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(command.id));

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: command.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, command.id, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(command.id);
      else if (!ids.has(command.id) || ids.size > 1) set([command.id]);
    },
    [command.id],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      name={`command:${command.id}`}
      id={command.id}
    >
      <Rect
        width={COMMAND_BOX.width}
        height={COMMAND_BOX.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke={isSelected ? "#22c55e" : "#a16207"}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        text={`/${command.name}`}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#fcd34d"
        listening={false}
      />
      <Text
        x={10}
        y={26}
        text="command"
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
    </Group>
  );
}
