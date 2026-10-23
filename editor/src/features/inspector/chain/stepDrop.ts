import type { StepFrame, StepPath } from "@/domain/stepPath";
import { type ClientRect, type CollisionDetection, pointerWithin } from "@dnd-kit/core";

/**
 * What a draggable step and a drop zone carry in their dnd-kit `data`: a step's path, or for a
 * whole list (`list: true`) its frames and its length — dropping there appends.
 */
export interface StepDragData extends StepPath {
  list?: boolean;
}

/**
 * The droppables under the pointer, smallest first: lists nest inside `if` steps, which nest
 * inside lists, so the smallest one under the pointer is the one the user aims at (a step row
 * rather than the branch around it, a branch rather than the `if` that holds it). The dragged
 * step itself is left out.
 */
export const innermostPointerCollision: CollisionDetection = (args) => {
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return pointerWithin(args)
    .filter((c) => c.id !== args.active.id)
    .sort((a, b) => area(a.id) - area(b.id));
};

/**
 * Where a step dropped on `over` goes. On a list: its end. On a step of the same list: that
 * step's index (array move, like a plain reorder). On a step of another list: before it, or after
 * it when the dragged step's centre is below that step's centre.
 */
export function dropTarget(
  from: StepPath,
  over: StepDragData,
  dragged: ClientRect | null,
  overRect: ClientRect,
): StepPath | null {
  const to: StepPath = { frames: over.frames, index: over.index };
  if (over.list || sameFrames(from.frames, over.frames)) return to;
  if (dragged && centerY(dragged) > centerY(overRect)) to.index += 1;
  return to;
}

function sameFrames(a: StepFrame[], b: StepFrame[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const centerY = (r: ClientRect) => r.top + r.height / 2;
