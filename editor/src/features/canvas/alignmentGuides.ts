export interface Box { x: number; y: number; width: number; height: number; }
export interface Guide { axis: "x" | "y"; pos: number; from: number; to: number; }
export interface AlignResult { snapX?: number; snapY?: number; guides: Guide[]; }

/** Snap + alignment guides of the dragged box vs the others, within threshold (world coords). Pure.
 *  X refs (vertical alignment / same column): left / centerX / right.
 *  Y refs (horizontal alignment / same row): top / centerY / bottom. */
export function alignmentGuides(dragged: Box, others: Box[], threshold: number): AlignResult {
  const xRefs = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
  const yRefs = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
  const dragX = xRefs(dragged); // [left, centerX, right]
  const dragY = yRefs(dragged);
  let bestX: { dist: number; target: number; refIndex: number } | null = null;
  let bestY: { dist: number; target: number; refIndex: number } | null = null;
  for (const o of others) {
    const ox = xRefs(o);
    const oy = yRefs(o);
    for (let i = 0; i < 3; i++) {
      for (const t of ox) {
        const d = Math.abs(dragX[i]! - t);
        if (d <= threshold && (!bestX || d < bestX.dist)) bestX = { dist: d, target: t, refIndex: i };
      }
      for (const t of oy) {
        const d = Math.abs(dragY[i]! - t);
        if (d <= threshold && (!bestY || d < bestY.dist)) bestY = { dist: d, target: t, refIndex: i };
      }
    }
  }
  const guides: Guide[] = [];
  let snapX: number | undefined;
  let snapY: number | undefined;
  if (bestX) {
    // refIndex 0=left,1=centerX,2=right → offset of the left corner: target - offset
    const offset = bestX.refIndex === 0 ? 0 : bestX.refIndex === 1 ? dragged.width / 2 : dragged.width;
    snapX = bestX.target - offset;
    const ys = [dragged.y, dragged.y + dragged.height, ...others.flatMap((o) => [o.y, o.y + o.height])];
    guides.push({ axis: "x", pos: bestX.target, from: Math.min(...ys), to: Math.max(...ys) });
  }
  if (bestY) {
    const offset = bestY.refIndex === 0 ? 0 : bestY.refIndex === 1 ? dragged.height / 2 : dragged.height;
    snapY = bestY.target - offset;
    const xs = [dragged.x, dragged.x + dragged.width, ...others.flatMap((o) => [o.x, o.x + o.width])];
    guides.push({ axis: "y", pos: bestY.target, from: Math.min(...xs), to: Math.max(...xs) });
  }
  return { snapX, snapY, guides };
}
