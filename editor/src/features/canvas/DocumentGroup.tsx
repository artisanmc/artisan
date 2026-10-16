import type { Document, Project, ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { dispatchOpenElement } from "./canvasEvents";
import { documentBoxSize } from "./menuLayout";
import { useNodeAlignment } from "./useNodeAlignment";

interface DocumentGroupProps {
  project: Project;
  kind: string;
  doc: Document;
  position: { x: number; y: number };
}

/**
 * The board node of a Document whose kind a module contributes (ADR
 * `extensible-document-kinds`, lot 5): the host's chrome (box, id, summary line,
 * selection, drag, double-click to open) around the kind's optional `board.render`
 * preview, which listens to nothing. Editing happens in the Properties panel; the
 * in-place editing menus have on the board is theirs alone.
 */
export function DocumentGroup({ project, kind, doc, position }: DocumentGroupProps) {
  const projectId = project.id as ProjectId;
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(doc.id));
  const lang = useUiStore((s) => s.activeLang);
  const nodeAlign = useNodeAlignment(projectId, doc.id);
  const contribution = documentKindContribution(kind);
  const size = documentBoxSize(kind);
  const summary = contribution?.board?.summary?.(doc, { project, lang }) ?? kind;
  const Preview = contribution?.board?.render;

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ projectId, nodeId: doc.id, x: e.target.x(), y: e.target.y() });
      useAlignmentStore.getState().clear();
    },
    [projectId, doc.id, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, menuId: selectionMenuId, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(doc.id);
      else if (selectionMenuId !== null || !ids.has(doc.id) || ids.size > 1) set([doc.id]);
    },
    [doc.id],
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
      onDblClick={() => dispatchOpenElement(doc.id)}
      onDblTap={() => dispatchOpenElement(doc.id)}
      name={`${kind}:${doc.id}`}
      id={doc.id}
    >
      <Rect
        width={size.width}
        height={size.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke={isSelected ? "#22c55e" : "#0ea5e9"}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        text={doc.id}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#7dd3fc"
        listening={false}
      />
      <Text
        x={10}
        y={30}
        text={summary}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
      {Preview ? (
        // A preview only: nothing inside it receives a pointer.
        <Group listening={false}>
          <Preview projectId={projectId} document={doc} size={size} />
        </Group>
      ) : null}
    </Group>
  );
}
