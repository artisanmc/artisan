/** Semantic constraints shared by the editor and backend gates. JSON Schema handles field types. */
export function imageButtonErrors(menu: unknown): string[] {
  const doc = menu as Record<string, any>;
  if (!doc || typeof doc !== "object") return [];
  const elements: Record<string, any>[] = Array.isArray(doc.elements) ? doc.elements :
    (Array.isArray(doc.layers) ? doc.layers.flatMap((layer: any) => layer?.elements ?? []) : []);
  const images = elements.filter((el) => el && [el, ...(Array.isArray(el.states) ? el.states : [])].some((app) => app?.image));
  if (!images.length) return [];
  const errors: string[] = [];
  const size = Number(doc.size);
  const cols = doc.inventory_type === "hopper" ? 5 : doc.inventory_type === "dropper" ? 3 : 9;
  const slotsOf = (positions: unknown): number[] | null => {
    const slots = new Set<number>();
    for (const part of String(positions ?? "").split(",")) {
      const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!match) return null;
      const a = Number(match[1]); const b = Number(match[2] ?? a);
      if (a >= size || b >= size || a > 53 || b > 53) return null;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) slots.add(i);
    }
    return [...slots];
  };
  for (const el of images) {
    const label = `Image button "${el.id}"`;
    if (el.iterates || el.places) errors.push(`${label} requires a fixed rectangular area.`);
    const slots = slotsOf(el.positions);
    if (!slots?.length) { errors.push(`${label} has invalid or out-of-bounds positions.`); continue; }
    const xs = slots.map((slot) => slot % cols); const ys = slots.map((slot) => Math.floor(slot / cols));
    if ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) !== slots.length) {
      errors.push(`${label} must cover a rectangle without gaps.`);
    }
    for (const other of elements) {
      if (other === el) continue;
      const otherSlots = [...(slotsOf(other.positions) ?? []), ...(other.places?.placements?.map((p: any) => p.position) ?? [])];
      if (otherSlots.some((slot) => slots.includes(slot))) errors.push(`${label} overlaps element "${other.id}".`);
    }
  }
  return errors;
}
