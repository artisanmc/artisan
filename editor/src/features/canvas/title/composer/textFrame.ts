import type { MenuTitleLayer } from "@/domain/types";

type Textarea = Extract<MenuTitleLayer, { kind: "textarea" }>;

export function asTextFrame(
  layer: Extract<MenuTitleLayer, { kind: "text" | "textarea" }>,
): Textarea {
  return layer.kind === "textarea"
    ? layer
    : {
        ...layer,
        kind: "textarea",
        width: 168,
        lineHeight: Math.min(32, (layer.size ?? 8) + 2),
        alignment: "left",
      };
}

// The saved format uses a text anchor; editing uses the frame's left edge.
export function textAnchorOffset(layer: Pick<Textarea, "width" | "alignment">): number {
  return layer.alignment === "center"
    ? Math.floor(layer.width / 2)
    : layer.alignment === "right"
      ? layer.width
      : 0;
}

export function patchTextFrame(layer: Textarea, patch: Partial<Textarea>): Textarea {
  const left = layer.x - textAnchorOffset(layer);
  const next = { ...layer, ...patch };
  return { ...next, x: (patch.x ?? left) + textAnchorOffset(next) };
}
