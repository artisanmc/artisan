import type { MenuTitleLayer } from "@/domain/types";
import type { UiLayer } from "./types";

export function toUiLayers(layers: MenuTitleLayer[]): UiLayer[] {
  return layers.map((l): UiLayer => {
    switch (l.kind) {
      case "background":
        return { kind: "image", assetId: l.assetId, x: 0, y: 0, stretchToChest: true };
      case "glyph":
        return { kind: "image", assetId: l.assetId, x: l.x, y: l.y, stretchToChest: false };
      case "text":
        // color is intentionally dropped (deprecated). fontAssetId passes through.
        return { kind: "text", value: l.value, x: l.x, y: l.y, fontAssetId: l.fontAssetId };
      case "external_glyph":
        return { kind: "external", layer: l };
    }
  });
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
