import type { MenuTitleLayer } from "@/domain/types";
import type { UiLayer } from "./types";

export function toUiLayers(layers: MenuTitleLayer[]): UiLayer[] {
  const out: UiLayer[] = [];
  for (const l of layers) {
    switch (l.kind) {
      case "background":
        out.push({ kind: "image", assetId: l.assetId, x: 0, y: 0, stretchToChest: true });
        break;
      case "glyph":
        out.push({ kind: "image", assetId: l.assetId, x: l.x, y: l.y, stretchToChest: false });
        break;
      case "text":
        // color is intentionally dropped (deprecated). fontAssetId passes through.
        out.push({ kind: "text", value: l.value, x: l.x, y: l.y, fontAssetId: l.fontAssetId });
        break;
      case "external_glyph":
        out.push({ kind: "external", layer: l });
        break;
      // `plain` and `textarea` aren't part of the positioned-layer canvas model
      // (UiLayer) — they're edited via their own forms. Skip them here.
      case "plain":
      case "textarea":
        break;
    }
  }
  return out;
}

export function fromUiLayers(ui: UiLayer[]): MenuTitleLayer[] {
  return ui.map((u): MenuTitleLayer => {
    switch (u.kind) {
      case "image":
        return u.stretchToChest
          ? { kind: "background", assetId: u.assetId }
          : { kind: "glyph", assetId: u.assetId, x: u.x, y: u.y };
      case "text":
        return {
          kind: "text",
          value: u.value,
          x: u.x,
          y: u.y,
          fontAssetId: u.fontAssetId,
          color: undefined,
        };
      case "external":
        return u.layer;
    }
  });
}
