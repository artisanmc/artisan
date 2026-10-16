// Legacy reader of a `menu/v1` title node. `menuV1ToDomain` carries its own
// title reader (the one the importer runs); this one is kept for its tests and
// any caller that only has a title node in hand.
import { assetId } from "@/domain/ids";
import type { I18nKey, MenuTitleLayer } from "@/domain/types";

const LEGACY_TEXT_X = 8;
const LEGACY_TEXT_Y = 5;
const TEXT_SIZES = [8, 12, 16, 20, 24, 32] as const;
type TextSize = (typeof TEXT_SIZES)[number];

function isTextSize(v: unknown): v is TextSize {
  return TEXT_SIZES.some((s) => s === v);
}

/**
 * Accepts the YAML node found at `menu.title` and normalises it to a
 * `MenuTitleLayer[]`. Supports:
 *
 * - `null`/`undefined`              → `[]`
 * - `string`                        → one text layer at (8,5) using the
 *                                     string as a literal i18n key (legacy
 *                                     format)
 * - single `{ kind, ... }` map      → wrapped in a one-element array
 * - `[{ kind, ... }, ...]`          → mapped element-by-element
 *
 * Unknown kinds are filtered out (caller-side import code can warn).
 */
export function parseTitleNode(node: unknown): MenuTitleLayer[] {
  if (node === null || node === undefined) return [];
  if (typeof node === "string") {
    // Canonical sugar (and legacy string format) → one plain vanilla layer.
    const key = titleValueKey(node);
    return key === null ? [] : [{ kind: "plain", value: { key } }];
  }
  if (Array.isArray(node)) {
    const out: MenuTitleLayer[] = [];
    for (const entry of node) {
      const layer = parseTitleLayer(entry);
      if (layer) out.push(layer);
    }
    return out;
  }
  if (typeof node === "object") {
    const layer = parseTitleLayer(node);
    return layer ? [layer] : [];
  }
  return [];
}

function titleValueKey(value: unknown): I18nKey | null {
  // Canonical string form: "{i18n:key}" (or a raw key for legacy string titles).
  if (typeof value === "string") {
    const m = /^\{i18n:(.+)\}$/.exec(value);
    return (m?.[1] ?? value) as I18nKey;
  }
  // Legacy {key} object form.
  if (value && typeof value === "object" && "key" in value && typeof value.key === "string") {
    return value.key as I18nKey;
  }
  return null;
}

function parseTitleLayer(node: unknown): MenuTitleLayer | null {
  // A bare string entry is a plain text layer (canonical sugar).
  if (typeof node === "string") {
    const key = titleValueKey(node);
    return key === null ? null : { kind: "plain", value: { key } };
  }
  if (!node || typeof node !== "object") return null;
  const m: Record<string, unknown> = { ...node };
  // Asset ref: `asset: <name>` first, then `asset_id: <opaque id>`. The file
  // name becomes an asset's identity (ADR `assets-on-server-disk`) — the old
  // form is still read until the migration has happened.
  const assetRef = (key: "asset" | "font"): string | null => {
    const current = m[key];
    if (typeof current === "string") return current;
    const legacy = m[key === "asset" ? "asset_id" : "font_asset_id"];
    if (typeof legacy === "string") return legacy;
    return null;
  };
  switch (m.kind) {
    case "background": {
      const ref = assetRef("asset");
      if (ref === null) return null;
      return { kind: "background", assetId: assetId(ref) };
    }
    case "glyph": {
      const ref = assetRef("asset");
      if (ref === null) return null;
      return {
        kind: "glyph",
        assetId: assetId(ref),
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
      };
    }
    case "text": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const out: MenuTitleLayer = {
        kind: "text",
        value: { key },
        x: typeof m.x === "number" ? m.x : LEGACY_TEXT_X,
        y: typeof m.y === "number" ? m.y : LEGACY_TEXT_Y,
      };
      if (typeof m.color === "string") out.color = m.color;
      const fontRef = assetRef("font");
      if (fontRef !== null) out.fontAssetId = assetId(fontRef);
      if (isTextSize(m.size)) out.size = m.size;
      return out;
    }
    case "plain": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const out: MenuTitleLayer = { kind: "plain", value: { key } };
      if (typeof m.color === "string") out.color = m.color;
      return out;
    }
    case "textarea": {
      const key = titleValueKey(m.value);
      if (!key) return null;
      const rawAlign = typeof m.alignment === "string" ? m.alignment : "left";
      const alignment: "left" | "center" | "right" =
        rawAlign === "center" ? "center" : rawAlign === "right" ? "right" : "left";
      const rawLh = typeof m.line_height === "number" ? m.line_height : 10;
      const lineHeight = Math.min(32, Math.max(1, rawLh));
      const rawW = typeof m.width === "number" ? m.width : 168;
      const width = Math.min(256, Math.max(8, rawW));
      const out: MenuTitleLayer = {
        kind: "textarea",
        value: { key },
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
        width,
        lineHeight,
        alignment,
      };
      const fontRef = assetRef("font");
      if (fontRef !== null) out.fontAssetId = assetId(fontRef);
      if (isTextSize(m.size)) out.size = m.size;
      return out;
    }
    case "external_glyph": {
      const provider = m.provider;
      if (provider !== "oraxen" && provider !== "nexo" && provider !== "itemsadder") return null;
      if (typeof m.glyph_name !== "string") return null;
      return {
        kind: "external_glyph",
        provider,
        glyphName: m.glyph_name,
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
      };
    }
    default:
      return null;
  }
}
