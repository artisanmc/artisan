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
import { Group, Rect, Text } from "react-konva";
import { dispatchOpenElement } from "./canvasEvents";
import { DOCUMENT_ITEMS, documentBoxSize, documentRowHeight } from "./menuLayout";
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
/** The tinted column that opens a row with a marker: its width. */
const MARKER_W = 34;

/**
 * The markers as drawn: ranks (all digits) on the same number of digits, two at least
 * (`01`… `10`), so they line up; any other mark as given.
 */
export function markerTexts(items: readonly BoardItem[]): (string | undefined)[] {
  const ranks = items.every((item) => item.marker && /^\d+$/.test(item.marker));
  if (!ranks) return items.map((item) => item.marker);
  const digits = Math.max(2, ...items.map((item) => item.marker!.length));
  return items.map((item) => item.marker!.padStart(digits, "0"));
}

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
  const rowH = documentRowHeight(items);
  const markers = markerTexts(items);
  const rowY = (i: number) => DOCUMENT_ITEMS.header + i * rowH;

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
      {items.map((item, i) => (
        <ItemRow
          key={item.id}
          y={rowY(i)}
          width={size.width}
          height={rowH - 3}
          item={item}
          marker={markers[i]}
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
  height: h,
  item,
  marker,
  accent,
  selected,
  onSelect,
}: {
  y: number;
  width: number;
  height: number;
  item: BoardItem;
  /** The row's marker as drawn (`markerTexts`). */
  marker: string | undefined;
  accent: string;
  selected: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const node = useNodeColors();
  const { label, detail, caption, hover } = item;
  const boxW = width - 12;
  const detailWidth = detail ? Math.min(90, boxW / 3) : 0;
  // With a marker, the texts start after its column.
  const textX = (marker ? MARKER_W : 0) + 9;
  const textW = boxW - textX - 8;
  const twoLines = h > DOCUMENT_ITEMS.row;
  const labelSize = twoLines ? 12.5 : 11;
  const labelY = twoLines ? h / 2 - 14 : (h - 11) / 2;
  const fg = selected ? node.rowSelectedFg : hovered ? node.fg : node.rowFg;
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
      <Rect
        width={boxW}
        height={h}
        cornerRadius={5}
        fill={selected ? node.rowSelected : hovered ? node.rowHover : node.row}
        stroke={selected ? "#22c55e" : undefined}
        strokeWidth={selected ? 1 : 0}
        perfectDrawEnabled={false}
      />
      {marker ? (
        <>
          {/* The rank opens the row, in a column tinted with the node's colour. */}
          <Rect
            width={MARKER_W}
            height={h}
            cornerRadius={[5, 0, 0, 5]}
            fill={selected ? "#22c55e" : accent}
            opacity={selected ? 0.25 : 0.1}
            listening={false}
          />
          <Rect
            x={MARKER_W - 1}
            width={1}
            height={h}
            fill={selected ? "#22c55e" : accent}
            opacity={0.3}
            listening={false}
          />
          <Text
            width={MARKER_W}
            y={(h - (twoLines ? 14 : 10)) / 2}
            align="center"
            text={marker}
            fontFamily="ui-monospace, monospace"
            fontSize={twoLines ? 14 : 10}
            fontStyle="bold"
            fill={selected ? "#22c55e" : accent}
            wrap="none"
            ellipsis
            listening={false}
          />
        </>
      ) : null}
      <Text
        x={textX}
        y={labelY}
        width={textW - detailWidth}
        text={label}
        fontSize={labelSize}
        fill={fg}
        wrap="none"
        ellipsis
        listening={false}
      />
      {caption ? (
        <Text
          x={textX}
          y={h / 2 + 3}
          width={textW}
          text={caption}
          fontSize={10.5}
          fill={node.sub}
          wrap="none"
          ellipsis
          listening={false}
        />
      ) : null}
      {detail ? (
        <Text
          x={textX + textW - detailWidth}
          y={labelY + (labelSize - 9) / 2}
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
