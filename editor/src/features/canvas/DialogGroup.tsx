import type { Dialog, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { DIALOG_BOX } from "./menuLayout";

interface DialogGroupProps {
  packId: PackId;
  dialog: Dialog;
  position: { x: number; y: number };
}

export function DialogGroup({ packId, dialog, position }: DialogGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(dialog.id));

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: dialog.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, dialog.id, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(dialog.id);
      else if (!ids.has(dialog.id) || ids.size > 1) set([dialog.id]);
    },
    [dialog.id],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      name={`dialog:${dialog.id}`}
      id={dialog.id}
    >
      <Rect
        width={DIALOG_BOX.width}
        height={DIALOG_BOX.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke={isSelected ? "#22c55e" : "#7c3aed"}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        text={dialog.id}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#c4b5fd"
        listening={false}
      />
      <Text
        x={10}
        y={30}
        text={`dialog · ${dialog.buttons.length}btn`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
    </Group>
  );
}
