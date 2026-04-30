import type { Command, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
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

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: command.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, command.id, setCanvasPosition],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragEnd={onDragEnd}
      name={`command:${command.id}`}
    >
      <Rect
        width={COMMAND_BOX.width}
        height={COMMAND_BOX.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke="#a16207"
        strokeWidth={1.5}
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
