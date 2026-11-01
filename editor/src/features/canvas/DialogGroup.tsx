import { docKey } from "@/domain/documents";
import type { Dialog, ProjectId } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { SystemTag } from "./SystemTag";
import { INHERITED_OPACITY, VariantTag, useVariantStatus } from "./VariantTag";
import { dispatchOpenElement } from "./canvasEvents";
import { commitNodeDrag } from "./commitNodeDrag";
import { DIALOG_BOX } from "./menuLayout";
import { useNodeColors } from "./nodeColors";
import { showFullTitle } from "./nodeTitle";
import { useNodeAlignment } from "./useNodeAlignment";

interface DialogGroupProps {
  projectId: ProjectId;
  dialog: Dialog;
  position: { x: number; y: number };
  /** The module whose system dialog this is: tagged above the box. */
  systemModule?: string;
}

export function DialogGroup({ projectId, dialog, position, systemModule }: DialogGroupProps) {
  const key = docKey("dialog", dialog.id);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(key));
  const variantStatus = useVariantStatus(projectId, "dialog", dialog.id);
  const nodeAlign = useNodeAlignment(projectId, key);
  const node = useNodeColors();
  const accent = useCssVar("--kind-dialog");
  const line = useCssVar("--kind-dialog-line");

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

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, menuId: selectionMenuId, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(key);
      else if (selectionMenuId !== null || !ids.has(key) || ids.size > 1) set([key]);
      // Selecting on the canvas opens the Edit tab so the chosen element is
      // immediately editable — no manual tab switch.
    },
    [key],
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
      onDblClick={() => dispatchOpenElement(key)}
      onDblTap={() => dispatchOpenElement(key)}
      // The title may be cut by its ellipsis: the full one shows on hover.
      onMouseEnter={(e) => showFullTitle(e, dialog.id)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`dialog:${dialog.id}`}
      id={key}
      opacity={variantStatus === "inherited" ? INHERITED_OPACITY : 1}
    >
      {systemModule && <SystemTag module={systemModule} width={DIALOG_BOX.width} />}
      {variantStatus && (
        <VariantTag
          projectId={projectId}
          status={variantStatus}
          width={DIALOG_BOX.width}
          y={systemModule ? -28 : -14}
        />
      )}
      <Rect
        width={DIALOG_BOX.width}
        height={DIALOG_BOX.height}
        cornerRadius={6}
        fill={node.bg}
        stroke={isSelected ? "#22c55e" : line}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        width={DIALOG_BOX.width - 20}
        wrap="none"
        ellipsis
        text={dialog.id}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill={accent}
        listening={false}
      />
      <Text
        x={10}
        y={30}
        width={DIALOG_BOX.width - 20}
        wrap="none"
        ellipsis
        text={`dialog · ${dialog.buttons.length}btn`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill={node.sub}
        listening={false}
      />
    </Group>
  );
}
