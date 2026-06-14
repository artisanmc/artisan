interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ids des boîtes qui intersectent le rectangle (coords monde). Rect normalisé (w/h peuvent être négatifs). */
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
