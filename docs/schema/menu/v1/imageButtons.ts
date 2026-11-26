import { PART_ANCHORS, lookImages } from "./imageButtonGeometry";

/** Semantic constraints shared by the editor and backend gates. JSON Schema handles field types. */
export function imageButtonErrors(menu: unknown): string[] {
  const doc = menu as Record<string, any>;
  if (!doc || typeof doc !== "object") return [];
  const elements: Record<string, any>[] = Array.isArray(doc.elements)
    ? doc.elements
    : Array.isArray(doc.layers)
      ? doc.layers.flatMap((layer: any) => layer?.elements ?? [])
      : [];
  const looksOf = (el: any): any[] => [el, ...(Array.isArray(el.states) ? el.states : [])];
  const errors: string[] = [];
  // A look made of pieces (`parts`): one way to write a look, each piece an image or a text.
  for (const el of elements) {
    if (!el) continue;
    for (const app of looksOf(el)) {
      if (!app || app.parts === undefined) continue;
      const label = `Element "${el.id}"`;
      if (app.image || app.label)
        errors.push(`${label} writes parts and an image or a label in one look: keep the parts.`);
      if (el.iterates || el.places)
        errors.push(`${label} iterates or places rows: its look cannot be made of parts.`);
      (Array.isArray(app.parts) ? app.parts : []).forEach((part: any, index: number) => {
        const isImage = typeof part?.image === "string" && part.image !== "";
        const isLabel =
          part?.label !== undefined && part?.label !== null && part?.image === undefined;
        if (isImage === isLabel)
          errors.push(
            `${label}: part ${index + 1} is an image (a name) or a label (a text), one of the two.`,
          );
        else if (isImage && /[{}]/.test(part.image))
          errors.push(
            `${label}: part ${index + 1} names its image with an expression; an image's name is written as is.`,
          );
        if (part?.anchor !== undefined && !PART_ANCHORS.includes(part.anchor))
          errors.push(`${label}: part ${index + 1} has an unknown anchor "${part.anchor}".`);
      });
    }
  }
  const images = elements.filter((el) => el && looksOf(el).some((app) => lookImages(app).length));
  if (!images.length) return errors;
  const size = Number(doc.size);
  const cols = doc.inventory_type === "hopper" ? 5 : doc.inventory_type === "dropper" ? 3 : 9;
  const slotsOf = (positions: unknown): number[] | null => {
    const slots = new Set<number>();
    for (const part of String(positions ?? "").split(",")) {
      const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!match) return null;
      const a = Number(match[1]);
      const b = Number(match[2] ?? a);
      if (a >= size || b >= size || a > 53 || b > 53) return null;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) slots.add(i);
    }
    return [...slots];
  };
  for (const el of images) {
    const label = `Image button "${el.id}"`;
    // A row-bound element (iterates/places) shows one 18×18 image per slot, chosen per row, and
    // may name a material or item for the rows whose image cannot be shown.
    if (el.iterates || el.places) continue;
    if (
      [el, ...(Array.isArray(el.states) ? el.states : [])].some(
        (app) => lookImages(app).length && (app.material || app.item),
      )
    )
      errors.push(
        `${label} names an image and an item in one look: its slots hold the invisible hit item.`,
      );
    const slots = slotsOf(el.positions);
    if (!slots?.length) {
      errors.push(`${label} has invalid or out-of-bounds positions.`);
      continue;
    }
    const xs = slots.map((slot) => slot % cols);
    const ys = slots.map((slot) => Math.floor(slot / cols));
    if (
      (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) !==
      slots.length
    ) {
      errors.push(`${label} must cover a rectangle without gaps.`);
    }
    for (const other of elements) {
      if (other === el) continue;
      const otherSlots = [
        ...(slotsOf(other.positions) ?? []),
        ...(other.places?.placements?.map((p: any) => p.position) ?? []),
      ];
      if (otherSlots.some((slot) => slots.includes(slot)))
        errors.push(`${label} overlaps element "${other.id}".`);
    }
  }
  return errors;
}
