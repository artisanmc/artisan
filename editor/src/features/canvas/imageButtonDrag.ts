import type { Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { TEX_SCALE } from "./menuLayout";
import { getStageGeometry } from "./stageGeometry";

export function imageDragSize(asset: { width: number; height: number }, scale: number) {
  return { width: asset.width * TEX_SCALE * scale, height: asset.height * TEX_SCALE * scale };
}

export const anchorImageDragToCursor: Modifier = ({
  active,
  activeNodeRect,
  activatorEvent,
  transform,
}) => {
  const asset = active?.data.current?.imageButton;
  const pointer = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!asset || !activeNodeRect || !pointer) return transform;
  const size = imageDragSize(asset, getStageGeometry()?.viewport.scale ?? 1);
  return {
    ...transform,
    x: transform.x + pointer.x - activeNodeRect.left - size.width / 2,
    y: transform.y + pointer.y - activeNodeRect.top - size.height / 2,
  };
};
