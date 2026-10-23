import type { ProjectId } from "@/domain/types";
import type { ModuleCommandNode, ModuleSubCommand } from "@/lib/moduleCommands";
import { useCssVar } from "@/lib/themeColors";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Circle, Group, Rect, Text } from "react-konva";
import { dispatchOpenSystemCommand } from "./canvasEvents";
import { COMMAND_BOX, MODULE_COMMAND_ROWS, commandBox } from "./menuLayout";
import { useNodeColors } from "./nodeColors";
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
 * struck when disabled, a row per sub-command (as a quest group lists its quests). A click
 * selects it, or the sub-command of the row, its override form in the Properties panel.
 * Never deleted here: the module declares it.
 */
export function ModuleCommandGroup({ projectId, node, position }: ModuleCommandGroupProps) {
  const { t } = useTranslation();
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);
  const nodeAlign = useNodeAlignment(projectId, node.id);
  const colors = useNodeColors();
  const accent = useCssVar("--kind-command");
  const line = useCssVar("--kind-command-line");
  const disabled = node.state === "disabled";
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(node.id));
  // The sub-command selected on its row, scoped by this node like an element by its menu.
  const selectedRow = useSelectionStore((s) =>
    s.menuId === node.id && s.ids.size === 1 ? [...s.ids][0]! : null,
  );
  const size = commandBox(node.command);

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
  const select = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const { ids, menuId, set } = useSelectionStore.getState();
      if (menuId !== null || !ids.has(node.id) || ids.size > 1) set([node.id]);
    },
    [node.id],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      opacity={disabled ? 0.55 : 1}
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={select}
      onTap={select}
      onDblClick={open}
      onDblTap={open}
      onMouseEnter={(e) => showFullTitle(e, `/${node.label}`)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`module-command:${node.id}`}
      id={node.id}
    >
      <Rect
        width={size.width}
        height={size.height}
        cornerRadius={6}
        fill={colors.bg}
        stroke={isSelected || selectedRow ? "#22c55e" : line}
        strokeWidth={isSelected ? 2 : 1.5}
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
        fill={accent}
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
        fill={colors.sub}
        listening={false}
      />
      {node.children.map((child, i) => (
        <SubCommandRow
          key={child.id}
          rootId={node.id}
          child={child}
          y={MODULE_COMMAND_ROWS.header + i * MODULE_COMMAND_ROWS.row}
          selected={selectedRow === child.id}
        />
      ))}
    </Group>
  );
}

/** One sub-command of the node: selectable apart from it, its card open in the panel. */
function SubCommandRow({
  rootId,
  child,
  y,
  selected,
}: {
  rootId: string;
  child: ModuleSubCommand;
  y: number;
  selected: boolean;
}) {
  const colors = useNodeColors();
  const accent = useCssVar("--kind-command");
  const disabled = child.state === "disabled";
  const indent = 6 + (child.depth - 1) * 10;
  const width = COMMAND_BOX.width - 12;
  const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    useSelectionStore.getState().set([child.id], null, rootId);
  };
  return (
    <Group
      x={6}
      y={y}
      onClick={select}
      onTap={select}
      onMouseEnter={(e) => showFullTitle(e, child.label)}
      onMouseLeave={(e) => showFullTitle(e, null)}
    >
      <Rect
        width={width}
        height={MODULE_COMMAND_ROWS.row - 3}
        cornerRadius={4}
        fill={selected ? colors.rowSelected : colors.row}
        perfectDrawEnabled={false}
      />
      <Text
        x={indent}
        y={5}
        width={width - indent - (child.state === "modified" ? 16 : 6)}
        wrap="none"
        ellipsis
        text={child.label}
        fontFamily="ui-monospace, monospace"
        fontSize={11}
        textDecoration={disabled ? "line-through" : ""}
        opacity={disabled ? 0.55 : 1}
        fill={selected ? colors.rowSelectedFg : accent}
        listening={false}
      />
      {child.state === "modified" && (
        <Circle x={width - 8} y={10} radius={3} fill="#22c55e" listening={false} />
      )}
    </Group>
  );
}
