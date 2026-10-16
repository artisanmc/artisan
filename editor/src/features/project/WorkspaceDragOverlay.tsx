import { ImageButtonDragPreview } from "@/features/canvas/ImageButtonLibrary";
import { readDrag } from "@/features/canvas/dragPayload";
import { anchorImageDragToCursor } from "@/features/canvas/imageButtonDrag";
import { getStageGeometry } from "@/features/canvas/stageGeometry";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { useUiStore } from "@/state/uiStore";
import { DragOverlay, useDndContext } from "@dnd-kit/core";

/** The ghost that follows a library material or an image button being dragged. */
export function WorkspaceDragOverlay() {
  const material = useUiStore((s) => s.activeDragMaterial);
  const { active } = useDndContext();
  const drag = readDrag(active);
  const asset = drag?.kind === "imageButton" ? drag.asset : undefined;
  return (
    <DragOverlay dropAnimation={null} modifiers={[anchorImageDragToCursor]}>
      {asset ? (
        <ImageButtonDragPreview asset={asset} scale={getStageGeometry()?.viewport.scale ?? 1} />
      ) : material ? (
        <LibraryDragGhost material={material} />
      ) : null}
    </DragOverlay>
  );
}

function LibraryDragGhost({ material }: { material: string }) {
  const url = getTextureUrl(material);
  return (
    <div
      className="pointer-events-none flex h-12 w-12 items-center justify-center rounded-[10px] border-2 border-[var(--brand)] bg-[var(--surface-raised)]/95"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      {url ? (
        <img
          src={url}
          alt={material}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="font-mono text-[8px] text-[var(--text-mut)]">{material.slice(0, 4)}</span>
      )}
    </div>
  );
}
