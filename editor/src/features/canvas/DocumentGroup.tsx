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
import { DOCUMENT_ITEMS, documentBoxSize } from "./menuLayout";
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
  // The part of this Document selected on its node (`board.items`), scoped like an element.
  const selectedItem = useSelectionStore((s) =>
    s.menuId === doc.id && s.ids.size === 1 ? [...s.ids][0]! : null,
  );
  const lang = useUiStore((s) => s.activeLang);
  const nodeAlign = useNodeAlignment(projectId, doc.id);
  const contribution = documentKindContribution(kind);
  const size = documentBoxSize(kind, doc, project);
  const summary = contribution?.board?.summary?.(doc, { project, lang }) ?? kind;
  const title = contribution?.title?.(doc, { project, lang }) || doc.id;
  const items = contribution?.board?.items?.(doc, { project, lang }) ?? [];
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
        stroke={isSelected || selectedItem ? "#22c55e" : "#0ea5e9"}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        width={size.width - 20}
        text={title}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#7dd3fc"
        wrap="none"
        ellipsis
        listening={false}
      />
      <Text
        x={10}
        y={30}
        width={size.width - 20}
        text={title === doc.id ? summary : `${doc.id} · ${summary}`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        wrap="none"
        ellipsis
        listening={false}
      />
      {items.map((item, i) => (
        <ItemRow
          key={item.id}
          y={DOCUMENT_ITEMS.header + i * DOCUMENT_ITEMS.row}
          width={size.width}
          label={item.label}
          detail={item.detail}
          selected={selectedItem === item.id}
          onSelect={(e) => {
            e.cancelBubble = true;
            useSelectionStore.getState().set([item.id], null, doc.id);
          }}
        />
      ))}
      {Preview ? (
        // A preview only: nothing inside it receives a pointer.
        <Group listening={false}>
          <Preview projectId={projectId} document={doc} size={size} />
        </Group>
      ) : null}
    </Group>
  );
}

/** One part of the Document (`board.items`), selectable apart from its node. */
function ItemRow({
  y,
  width,
  label,
  detail,
  selected,
  onSelect,
}: {
  y: number;
  width: number;
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const h = DOCUMENT_ITEMS.row - 3;
  const detailWidth = detail ? Math.min(90, width / 3) : 0;
  return (
    <Group x={6} y={y} onClick={onSelect} onTap={onSelect}>
      <Rect
        width={width - 12}
        height={h}
        cornerRadius={4}
        fill={selected ? "#14532d" : "#27272a"}
        stroke={selected ? "#22c55e" : undefined}
        strokeWidth={selected ? 1 : 0}
        perfectDrawEnabled={false}
      />
      <Text
        x={8}
        y={(h - 11) / 2}
        width={width - 28 - detailWidth}
        text={label}
        fontSize={11}
        fill={selected ? "#f4f4f5" : "#d4d4d8"}
        wrap="none"
        ellipsis
        listening={false}
      />
      {detail ? (
        <Text
          x={width - 20 - detailWidth}
          y={(h - 9) / 2}
          width={detailWidth}
          align="right"
          text={detail}
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill="#71717a"
          wrap="none"
          ellipsis
          listening={false}
        />
      ) : null}
    </Group>
  );
}
