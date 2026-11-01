import { commandNodeAt, walkCommandNodes } from "@/domain/commandNodes";
import { docKey } from "@/domain/documents";
import type { Command, ProjectId } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useCommandNodeStore } from "@/state/commandNodeStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useMemo } from "react";
import { Group, Rect, Text } from "react-konva";
import { INHERITED_OPACITY, VariantTag, useVariantStatus } from "./VariantTag";
import { dispatchOpenElement } from "./canvasEvents";
import { commitNodeDrag } from "./commitNodeDrag";
import { COMMAND_BOX, COMMAND_ROWS, commandBox } from "./menuLayout";
import { useNodeColors } from "./nodeColors";
import { showFullTitle } from "./nodeTitle";
import { rowsOpening } from "./subCommandAnchors";
import { useNodeAlignment } from "./useNodeAlignment";

interface CommandGroupProps {
  projectId: ProjectId;
  command: Command;
  position: { x: number; y: number };
}

/**
 * A command on the board: its name, then a row per sub-command (as a quest group lists its
 * quests), indented by depth. A command or sub-command turned off is struck and faded.
 * Clicking a row selects the command with the inspector on that sub-command; hovering a
 * link this command draws outlines the rows that open its target.
 */
export function CommandGroup({ projectId, command, position }: CommandGroupProps) {
  const key = docKey("command", command.id);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(key));
  const variantStatus = useVariantStatus(projectId, "command", command.id);
  const nodeAlign = useNodeAlignment(projectId, key);
  const node = useNodeColors();
  const accent = useCssVar("--kind-command");
  const line = useCssVar("--kind-command-line");
  const size = commandBox(command);
  const disabled = command.enabled === false;
  const rows = [...walkCommandNodes(command)].slice(1).map((v) => ({
    key: v.path.join("."),
    path: v.path,
    label: v.words.slice(1).join(" "),
    depth: v.path.length,
    // Off with its parent: the sub-command is gone with it.
    off: v.path.some((_, i) => commandNodeAt(command, v.path.slice(0, i + 1))?.enabled === false),
  }));

  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  // Only the hovered link's target when this command draws it: other nodes don't re-render.
  const hoveredTarget = useEdgeHoverStore((s) => (s.edge?.source === key ? s.edge.target : null));
  const linkedRows = useMemo(
    () => new Set(project && hoveredTarget ? rowsOpening(project, command, hoveredTarget) : []),
    [project, command, hoveredTarget],
  );

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      commitNodeDrag(projectId, key, e.target);
      useAlignmentStore.getState().clear();
    },
    [projectId, key],
  );

  // `path` is the sub-command row clicked, the root for the node itself.
  const select = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, path: number[]) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, menuId: selectionMenuId, set, toggle } = useSelectionStore.getState();
      if (additive) {
        toggle(key);
        return;
      }
      useCommandNodeStore.getState().select(command.id, path);
      if (selectionMenuId !== null || !ids.has(key) || ids.size > 1) set([key]);
      // Selecting on the canvas opens the Edit tab so the chosen element is
      // immediately editable — no manual tab switch.
    },
    [key, command.id],
  );
  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => select(e, []),
    [select],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      opacity={(disabled ? 0.55 : 1) * (variantStatus === "inherited" ? INHERITED_OPACITY : 1)}
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={() => dispatchOpenElement(key)}
      onDblTap={() => dispatchOpenElement(key)}
      // The title may be cut by its ellipsis: the full one shows on hover.
      onMouseEnter={(e) => showFullTitle(e, `/${command.name}`)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`command:${command.id}`}
      id={key}
    >
      {variantStatus && (
        <VariantTag projectId={projectId} status={variantStatus} width={size.width} />
      )}
      <Rect
        width={size.width}
        height={size.height}
        cornerRadius={6}
        fill={node.bg}
        stroke={isSelected ? "#22c55e" : line}
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
        textDecoration={disabled ? "line-through" : ""}
        fill={accent}
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
        fill={node.sub}
        listening={false}
      />
      {rows.map((row, i) => (
        <Group
          key={row.key}
          x={6}
          y={COMMAND_ROWS.header + i * COMMAND_ROWS.row}
          onClick={(e) => select(e, row.path)}
          onTap={(e) => select(e, row.path)}
          onMouseEnter={(e) => {
            showFullTitle(e, `/${command.name} ${row.label}`);
            pointer(e, true);
          }}
          onMouseLeave={(e) => {
            showFullTitle(e, null);
            pointer(e, false);
          }}
        >
          <Rect
            width={COMMAND_BOX.width - 12}
            height={COMMAND_ROWS.row - 3}
            cornerRadius={4}
            fill={node.row}
            stroke={linkedRows.has(i) ? "#22c55e" : undefined}
            strokeWidth={linkedRows.has(i) ? 1.5 : 0}
            perfectDrawEnabled={false}
          />
          <Text
            x={6 + (row.depth - 1) * 10}
            y={5}
            width={COMMAND_BOX.width - 24 - (row.depth - 1) * 10}
            wrap="none"
            ellipsis
            text={row.label}
            fontFamily="ui-monospace, monospace"
            fontSize={11}
            textDecoration={row.off ? "line-through" : ""}
            opacity={row.off ? 0.55 : 1}
            fill={accent}
            listening={false}
          />
        </Group>
      ))}
    </Group>
  );
}

/** A sub-command row is a click target: the pointer says so. */
function pointer(e: Konva.KonvaEventObject<MouseEvent>, on: boolean) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = on ? "pointer" : "";
}
