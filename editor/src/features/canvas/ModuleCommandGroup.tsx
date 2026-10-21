import type { ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import type Konva from "konva";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Circle, Group, Rect, Text } from "react-konva";
import { dispatchOpenSystemCommand } from "./canvasEvents";
import { COMMAND_BOX } from "./menuLayout";
import type { ModuleCommandNode } from "./moduleCommands";
import { showFullTitle } from "./nodeTitle";
import { useNodeAlignment } from "./useNodeAlignment";

interface ModuleCommandGroupProps {
  projectId: ProjectId;
  node: ModuleCommandNode;
  position: { x: number; y: number };
}

/**
 * A command a module declares, on the board of its folder: framed apart from the folder's
 * own commands (dashed, the module named under it), marked once the admin changed it,
 * struck when disabled. Never selected or deleted here: a double click opens its System page.
 */
export function ModuleCommandGroup({ projectId, node, position }: ModuleCommandGroupProps) {
  const { t } = useTranslation();
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);
  const nodeAlign = useNodeAlignment(projectId, node.id);
  const disabled = node.state === "disabled";

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ projectId, nodeId: node.id, x: e.target.x(), y: e.target.y() });
      useAlignmentStore.getState().clear();
    },
    [projectId, node.id, setCanvasPosition],
  );

  const open = useCallback(() => dispatchOpenSystemCommand(node.id), [node.id]);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      opacity={disabled ? 0.55 : 1}
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.cancelBubble = true;
      }}
      onTap={(e) => {
        e.cancelBubble = true;
      }}
      onDblClick={open}
      onDblTap={open}
      onMouseEnter={(e) => showFullTitle(e, `/${node.label}`)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`module-command:${node.id}`}
      id={node.id}
    >
      <Rect
        width={COMMAND_BOX.width}
        height={COMMAND_BOX.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke="#a16207"
        strokeWidth={1.5}
        dash={[5, 3]}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        width={COMMAND_BOX.width - (node.state === "modified" ? 30 : 20)}
        wrap="none"
        ellipsis
        text={`/${node.label}`}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        textDecoration={disabled ? "line-through" : ""}
        fill="#fcd34d"
        listening={false}
      />
      {node.state === "modified" && (
        <Circle x={COMMAND_BOX.width - 12} y={16} radius={3.5} fill="#22c55e" listening={false} />
      )}
      <Text
        x={10}
        y={26}
        width={COMMAND_BOX.width - 20}
        wrap="none"
        ellipsis
        text={t("canvas.moduleCommand", { module: node.moduleId })}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
    </Group>
  );
}
