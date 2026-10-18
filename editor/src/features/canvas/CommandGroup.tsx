import type { Command, ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { dispatchOpenElement } from "./canvasEvents";
import { COMMAND_BOX } from "./menuLayout";
import { showFullTitle } from "./nodeTitle";
import { useNodeAlignment } from "./useNodeAlignment";

interface CommandGroupProps {
  projectId: ProjectId;
  command: Command;
  position: { x: number; y: number };
}

export function CommandGroup({ projectId, command, position }: CommandGroupProps) {
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(command.id));
  const nodeAlign = useNodeAlignment(projectId, command.id);

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ projectId, nodeId: command.id, x: e.target.x(), y: e.target.y() });
      useAlignmentStore.getState().clear();
    },
    [projectId, command.id, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, menuId: selectionMenuId, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(command.id);
      else if (selectionMenuId !== null || !ids.has(command.id) || ids.size > 1) set([command.id]);
      // Selecting on the canvas opens the Edit tab so the chosen element is
      // immediately editable — no manual tab switch.
    },
    [command.id],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={() => dispatchOpenElement(command.id)}
      onDblTap={() => dispatchOpenElement(command.id)}
      // The title may be cut by its ellipsis: the full one shows on hover.
      onMouseEnter={(e) => showFullTitle(e, `/${command.name}`)}
      onMouseLeave={(e) => showFullTitle(e, null)}
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
        width={COMMAND_BOX.width - 20}
        wrap="none"
        ellipsis
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
        width={COMMAND_BOX.width - 20}
        wrap="none"
        ellipsis
        text="command"
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
    </Group>
  );
}
