interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ids of the boxes intersecting the rectangle (world coords). Normalised rect (w/h may be negative). */
export function rectIntersectsBoxes(rect: Box, boxes: Record<string, Box>): string[] {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  const out: string[] = [];
  for (const [id, b] of Object.entries(boxes)) {
    if (b.x < x2 && b.x + b.width > x1 && b.y < y2 && b.y + b.height > y1) out.push(id);
  }
  return out;
}
