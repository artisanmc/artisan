import type { Document, Project, ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useDocumentItemHoverStore } from "@/state/documentItemHoverStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import type { BoardItem } from "@artisan/editor-sdk";
import type Konva from "konva";
import { useCallback, useEffect, useState } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import { dispatchOpenElement } from "./canvasEvents";
import { DOCUMENT_ITEMS, documentBoxSize } from "./menuLayout";
import { useNodeColors } from "./nodeColors";
import { showFullTitle } from "./nodeTitle";
import { useNodeAlignment } from "./useNodeAlignment";

interface DocumentGroupProps {
  project: Project;
  kind: string;
  doc: Document;
  position: { x: number; y: number };
  /** The Document's own view (focus): nothing to move, nothing to open. */
  solo?: boolean;
}

/** The host's colour of a module node, when its kind declares no `board.accent`. */
const DEFAULT_ACCENT = "#0ea5e9";
/** A row's marker disc: centre x inside the node, radius. */
const MARKER = { x: 17, r: 9 };

/**
 * The board node of a Document whose kind a module contributes (ADR
 * `extensible-document-kinds`, lot 5): the host's chrome (box, id, summary line,
 * selection, drag, double-click to open) around the kind's optional `board.render`
 * preview, which listens to nothing. Editing happens in the Properties panel; the
 * in-place editing menus have on the board is theirs alone.
 */
export function DocumentGroup({ project, kind, doc, position, solo }: DocumentGroupProps) {
  const projectId = project.id as ProjectId;
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(doc.id));
  // The part of this Document selected on its node (`board.items`), scoped like an element.
  const selectedItem = useSelectionStore((s) =>
    s.menuId === doc.id && s.ids.size === 1 ? [...s.ids][0]! : null,
  );
  const lang = useUiStore((s) => s.activeLang);
  const nodeAlign = useNodeAlignment(projectId, doc.id);
  const node = useNodeColors();
  const contribution = documentKindContribution(kind);
  const size = documentBoxSize(kind, doc, project);
  const summary = contribution?.board?.summary?.(doc, { project, lang }) ?? kind;
  const title = contribution?.title?.(doc, { project, lang }) || doc.id;
  const items = contribution?.board?.items?.(doc, { project, lang }) ?? [];
  const Preview = contribution?.board?.render;
  const accent = contribution?.board?.accent ?? DEFAULT_ACCENT;
  // Parts that run in order: their discs form a line, top to bottom.
  const ordered = items.length > 1 && items.every((item) => item.marker);
  const rowY = (i: number) => DOCUMENT_ITEMS.header + i * DOCUMENT_ITEMS.row;
  const rowMid = (DOCUMENT_ITEMS.row - 3) / 2;

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
      draggable={!solo}
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={solo ? undefined : () => dispatchOpenElement(doc.id)}
      onDblTap={solo ? undefined : () => dispatchOpenElement(doc.id)}
      // The title may be cut by its ellipsis: the full one shows on hover.
      onMouseEnter={(e) => showFullTitle(e, title)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`${kind}:${doc.id}`}
      id={doc.id}
    >
      <Rect
        width={size.width}
        height={size.height}
        cornerRadius={8}
        fill={node.bg}
        stroke={isSelected || selectedItem ? "#22c55e" : accent}
        strokeWidth={isSelected ? 2 : 1.5}
        shadowColor="#000000"
        shadowBlur={10}
        shadowOpacity={node.shadow}
        shadowOffsetY={2}
        perfectDrawEnabled={false}
      />
      {/* Header band in the kind's colour. */}
      <Rect
        x={1}
        y={1}
        width={size.width - 2}
        height={DOCUMENT_ITEMS.header - 6}
        cornerRadius={[7, 7, 0, 0]}
        fill={accent}
        opacity={0.12}
        listening={false}
      />
      <Rect
        x={10}
        y={8}
        width={3}
        height={DOCUMENT_ITEMS.header - 22}
        cornerRadius={2}
        fill={accent}
        listening={false}
      />
      <Text
        x={20}
        y={9}
        width={size.width - 30}
        text={title}
        fontSize={13}
        fontStyle="600"
        fill={node.fg}
        wrap="none"
        ellipsis
        listening={false}
      />
      <Text
        x={20}
        y={27}
        width={size.width - 30}
        text={title === doc.id ? summary : `${doc.id} · ${summary}`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill={node.sub}
        wrap="none"
        ellipsis
        listening={false}
      />
      {ordered ? (
        <Line
          points={[MARKER.x, rowY(0) + rowMid, MARKER.x, rowY(items.length - 1) + rowMid]}
          stroke={accent}
          strokeWidth={2}
          opacity={0.45}
          listening={false}
        />
      ) : null}
      {items.map((item, i) => (
        <ItemRow
          key={item.id}
          y={rowY(i)}
          width={size.width}
          item={item}
          accent={accent}
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
  item,
  accent,
  selected,
  onSelect,
}: {
  y: number;
  width: number;
  item: BoardItem;
  accent: string;
  selected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const node = useNodeColors();
  const h = DOCUMENT_ITEMS.row - 3;
  const { label, detail, marker, hover } = item;
  const detailWidth = detail ? Math.min(90, width / 3) : 0;
  // With a marker, the row's box starts after its disc.
  const boxX = marker ? MARKER.x + MARKER.r + 4 - 6 : 0;
  const boxW = width - 12 - boxX;
  const setHover = useDocumentItemHoverStore((s) => s.set);
  // A row removed under the pointer (its quest deleted) leaves no tooltip behind.
  useEffect(() => {
    if (!hovered || !hover) return;
    return () => useDocumentItemHoverStore.getState().set(null);
  }, [hovered, hover]);
  const track = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (hover) setHover(hover, e.evt.clientX, e.evt.clientY);
  };
  return (
    <Group
      x={6}
      y={y}
      onClick={onSelect}
      onTap={onSelect}
      onMouseEnter={(e) => {
        setHovered(true);
        track(e);
      }}
      onMouseMove={track}
      onMouseLeave={() => {
        setHovered(false);
        if (hover) setHover(null);
      }}
    >
      {marker ? (
        <>
          <Circle
            x={MARKER.x - 6}
            y={h / 2}
            radius={MARKER.r}
            fill={selected ? "#22c55e" : node.bg}
            stroke={selected ? "#22c55e" : accent}
            strokeWidth={1.5}
            perfectDrawEnabled={false}
          />
          <Text
            x={MARKER.x - 6 - MARKER.r}
            y={h / 2 - 5}
            width={MARKER.r * 2}
            align="center"
            text={marker}
            fontFamily="ui-monospace, monospace"
            fontSize={10}
            fontStyle="600"
            fill={selected ? "#052e16" : node.fg}
            wrap="none"
            listening={false}
          />
        </>
      ) : null}
      <Rect
        x={boxX}
        width={boxW}
        height={h}
        cornerRadius={4}
        fill={selected ? node.rowSelected : hovered ? node.rowHover : node.row}
        stroke={selected ? "#22c55e" : undefined}
        strokeWidth={selected ? 1 : 0}
        perfectDrawEnabled={false}
      />
      <Text
        x={boxX + 8}
        y={(h - 11) / 2}
        width={boxW - 16 - detailWidth}
        text={label}
        fontSize={11}
        fill={selected ? node.rowSelectedFg : hovered ? node.fg : node.rowFg}
        wrap="none"
        ellipsis
        listening={false}
      />
      {detail ? (
        <Text
          x={boxX + boxW - 8 - detailWidth}
          y={(h - 9) / 2}
          width={detailWidth}
          align="right"
          text={detail}
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill={node.sub}
          wrap="none"
          ellipsis
          listening={false}
        />
      ) : null}
    </Group>
  );
}
