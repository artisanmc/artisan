import type { AssetId, LText } from "@/domain/types";
import type { MenuTitleLayer } from "@/domain/types";

/**
 * Editor-only view model for title layers. Decouples the UX from the
 * runtime `MenuTitleLayer` kinds (background/glyph/text/external_glyph).
 *
 * - `image` collapses runtime `background` + `glyph` into one user-facing
 *   concept: an image somewhere in the title. `stretchToChest === true` means
 *   it covers the full chest (runtime `background`); otherwise it's a
 *   positioned glyph with explicit x/y.
 * - `text` mirrors runtime text minus the deprecated `color` field; coloring
 *   is expressed via MiniMessage tags inside the LText value.
 * - `external` is a passthrough for runtime `external_glyph` layers.
 *   No editable side panel; rendered as a dashed placeholder.
 */
export type UiLayer =
  | { kind: "image"; assetId: AssetId; x: number; y: number; stretchToChest: boolean }
  | { kind: "text"; value: LText; x: number; y: number; fontAssetId?: AssetId }
  | { kind: "external"; layer: Extract<MenuTitleLayer, { kind: "external_glyph" }> };
