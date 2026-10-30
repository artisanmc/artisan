/**
 * A HUD laid out as layers (SDK 1.16), the editor's side of the plugin's `OverlayLayout` (API
 * 2.21.0): the same YAML list, the same problems, the same placement. Pure: the composer draws
 * from it, and a module asks the pack for its images with it. Locked by
 * `testdata/overlay-layout-conformance.json`.
 *
 * Positions are GUI px from the slot's origin: x from the centre of the screen, y from the top
 * of the slot's text line, downwards (`rise = -y`). Every top stays within
 * `OVERLAY_MIN_Y`..`OVERLAY_MAX_Y`.
 */
import type { PackImage } from "./types";

// Rises are `0 - y`, never `-y`: a y of 0 gives the rise 0, not -0.

/** Highest top of a layer: 128 px above the slot's text. */
export const OVERLAY_MIN_Y = -128;
/** Lowest top of a layer: 166 px under it. */
export const OVERLAY_MAX_Y = 166;
/** Default distance between two rows' tops: the vanilla line. */
export const OVERLAY_DEFAULT_ROW = 11;

const MAX_X = 1024;
const MAX_WIDTH = 1024;
const MAX_LINES = 32;
const MAX_ROW = 64;
const MAX_CURSOR_OFFSET = 64;

export type OverlayAlign = "left" | "center" | "right";
export type OverlayAnchor = "top" | "bottom";

export interface OverlayCursor {
  image: string;
  x: number;
  y: number;
}

/** One layer, as read: every field set, defaults filled in. */
export type OverlayLayer =
  | { kind: "image"; name: string; x: number; y: number }
  | { kind: "image_slot"; name: string; x: number; y: number; anchor: OverlayAnchor }
  | {
      kind: "text";
      name: string;
      x: number;
      y: number;
      width: number;
      lines: number;
      row: number;
      align: OverlayAlign;
    }
  | {
      kind: "list";
      name: string;
      x: number;
      y: number;
      width: number;
      lines: number;
      row: number;
      cursor: OverlayCursor | null;
    };

export type OverlayLayerKind = OverlayLayer["kind"];

/** Something wrong in a layout's YAML: where (`layout[2].width`), a stable code, what was read. */
export interface OverlayProblem {
  path: string;
  code:
    | "not_a_list"
    | "not_a_layer"
    | "unknown_layer"
    | "missing_name"
    | "missing_field"
    | "not_a_number"
    | "out_of_range"
    | "unknown_value"
    | "duplicate_slot";
  detail: string;
}

/** One entry of the YAML list: its layer when it can be drawn, its problems. */
export interface OverlayEntry {
  index: number;
  layer: OverlayLayer | null;
  problems: OverlayProblem[];
}

export interface OverlayRead {
  /** The layers that can be drawn, in order. */
  layers: OverlayLayer[];
  /** Every entry of the list, drawable or not, so an editor keeps what it cannot read. */
  entries: OverlayEntry[];
  problems: OverlayProblem[];
}

const KINDS: OverlayLayerKind[] = ["image", "image_slot", "text", "list"];

function isMap(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Reads one entry of the list; `problems` gets what is wrong with it. */
function readLayer(src: unknown, path: string, problems: OverlayProblem[]): OverlayLayer | null {
  const before = problems.length;
  const problem = (at: string, code: OverlayProblem["code"], detail: string) =>
    problems.push({ path: at, code, detail });
  const bad = () => problems.length > before;
  if (!isMap(src)) {
    problem(path, "not_a_layer", String(src));
    return null;
  }
  const kinds = KINDS.filter((k) => k in src && src[k] !== undefined);
  if (kinds.length !== 1) {
    problem(path, "unknown_layer", kinds.length ? kinds.join(", ") : Object.keys(src).join(", "));
    return null;
  }
  const kind = kinds[0]!;
  const name = (map: Record<string, unknown>, key: string, at: string) => {
    const value = map[key];
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) problem(at, "missing_name", String(value));
    return text;
  };
  const number = (
    map: Record<string, unknown>,
    key: string,
    fallback: number,
    min: number,
    max: number,
    at = path,
  ) => {
    const value = map[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      problem(`${at}.${key}`, "not_a_number", String(value));
      return fallback;
    }
    if (value < min || value > max) {
      problem(`${at}.${key}`, "out_of_range", String(value));
      return fallback;
    }
    return value;
  };
  const required = (key: string, min: number, max: number) => {
    if (src[key] === undefined || src[key] === null) {
      problem(`${path}.${key}`, "missing_field", "");
      return min;
    }
    return number(src, key, min, min, max);
  };
  const choice = <T extends string>(key: string, fallback: T, values: readonly T[]): T => {
    const value = src[key];
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim().toLowerCase();
    const found = values.find((v) => v === text);
    if (found) return found;
    problem(`${path}.${key}`, "unknown_value", String(value));
    return fallback;
  };
  const lines = (y: number, row: number) => {
    const n = number(src, "lines", 1, 1, MAX_LINES);
    if (!bad() && y + (n - 1) * row > OVERLAY_MAX_Y)
      problem(`${path}.lines`, "out_of_range", String(n));
    return n;
  };

  const layerName = name(src, kind, `${path}.${kind}`);
  const x = number(src, "x", 0, -MAX_X, MAX_X);
  const y = number(src, "y", 0, OVERLAY_MIN_Y, OVERLAY_MAX_Y);
  let layer: OverlayLayer;
  if (kind === "image") {
    layer = { kind, name: layerName, x, y };
  } else if (kind === "image_slot") {
    layer = { kind, name: layerName, x, y, anchor: choice("anchor", "top", ["top", "bottom"]) };
  } else {
    const width = required("width", 1, MAX_WIDTH);
    const row = number(src, "row", OVERLAY_DEFAULT_ROW, 1, MAX_ROW);
    const n = lines(y, row);
    if (kind === "text") {
      const align = choice("align", "left", ["left", "center", "right"]);
      layer = { kind, name: layerName, x, y, width, lines: n, row, align };
    } else {
      let cursor: OverlayCursor | null = null;
      const value = src.cursor;
      if (value !== undefined && value !== null) {
        const at = `${path}.cursor`;
        if (!isMap(value)) {
          problem(at, "not_a_layer", String(value));
        } else {
          const image = name(value, "image", `${at}.image`);
          const cx = number(value, "x", 0, -MAX_CURSOR_OFFSET, MAX_CURSOR_OFFSET, at);
          const cy = number(value, "y", 0, -MAX_CURSOR_OFFSET, MAX_CURSOR_OFFSET, at);
          if (!bad() && (y + cy < OVERLAY_MIN_Y || y + (n - 1) * row + cy > OVERLAY_MAX_Y))
            problem(`${at}.y`, "out_of_range", String(cy));
          cursor = { image, x: cx, y: cy };
        }
      }
      layer = { kind, name: layerName, x, y, width, lines: n, row, cursor };
    }
  }
  return bad() ? null : layer;
}

/**
 * A layout from its YAML list. A layer with a problem is left out of `layers` (its entry
 * stays); null or absent reads as an empty layout.
 */
export function readOverlayLayout(yaml: unknown): OverlayRead {
  const problems: OverlayProblem[] = [];
  const entries: OverlayEntry[] = [];
  const layers: OverlayLayer[] = [];
  if (yaml === null || yaml === undefined) return { layers, entries, problems };
  if (!Array.isArray(yaml)) {
    problems.push({ path: "layout", code: "not_a_list", detail: String(yaml) });
    return { layers, entries, problems };
  }
  const slots = new Set<string>();
  yaml.forEach((src, index) => {
    const path = `layout[${index}]`;
    const own: OverlayProblem[] = [];
    let layer = readLayer(src, path, own);
    if (layer && layer.kind !== "image") {
      if (slots.has(layer.name)) {
        own.push({ path, code: "duplicate_slot", detail: layer.name });
        layer = null;
      } else slots.add(layer.name);
    }
    if (layer) layers.push(layer);
    problems.push(...own);
    entries.push({ index, layer, problems: own });
  });
  return { layers, entries, problems };
}

/** A layer back to its YAML entry, defaults left out (what an editor writes). */
export function writeOverlayLayer(layer: OverlayLayer): Record<string, unknown> {
  const out: Record<string, unknown> = { [layer.kind]: layer.name, x: layer.x, y: layer.y };
  if (layer.kind === "image_slot" && layer.anchor !== "top") out.anchor = layer.anchor;
  if (layer.kind === "text" || layer.kind === "list") {
    out.width = layer.width;
    if (layer.lines !== 1) out.lines = layer.lines;
    if (layer.row !== OVERLAY_DEFAULT_ROW) out.row = layer.row;
  }
  if (layer.kind === "text" && layer.align !== "left") out.align = layer.align;
  if (layer.kind === "list" && layer.cursor) {
    const { image, x, y } = layer.cursor;
    out.cursor = { image, x, y };
  }
  return out;
}

/** The fixed images of a layout at their rise: each `image`, each cursor at every row of its list. */
export function overlayPackImages(layers: readonly OverlayLayer[]): PackImage[] {
  const out: PackImage[] = [];
  for (const layer of layers) {
    if (layer.kind === "image") out.push({ asset: layer.name, rise: 0 - layer.y });
    else if (layer.kind === "list" && layer.cursor) {
      for (let i = 0; i < layer.lines; i++)
        out.push({
          asset: layer.cursor.image,
          rise: 0 - (layer.y + i * layer.row + layer.cursor.y),
        });
    }
  }
  return out;
}

/** The rise of an image `height` px tall put in an `image_slot`. */
export function overlaySlotRise(
  slot: { y: number; anchor: OverlayAnchor },
  height: number,
): number {
  return slot.anchor === "bottom" ? height - slot.y : 0 - slot.y;
}

/** What fills the named layers for one frame (the plugin's `OverlayContent`). */
export interface OverlayContent {
  /** Rows of a `text` layer, MiniMessage, already cut to its width. */
  text?: Record<string, readonly string[]>;
  /** Rows of a `list`: `selected` a row or -1, `top` the first shown. */
  lists?: Record<string, { rows: readonly string[]; selected: number; top: number }>;
  /** The asset of an `image_slot`. */
  images?: Record<string, string>;
}

/** An image (`content` its asset) or a row of text (`content` its MiniMessage), its left at x, its top at rise. */
export interface OverlayDraw {
  image: boolean;
  content: string;
  x: number;
  rise: number;
  /** The layer it belongs to, by its index in `layers`. */
  layer: number;
}

/**
 * Where each piece of a frame goes, as the plugin's `OverlayApi.compose` places it: rows
 * aligned in their layer's width, a list from its first visible row with the cursor beside the
 * selected one, a slot's image by its top or bottom (`missing` when its height is unknown).
 */
export function overlayPlan(
  layers: readonly OverlayLayer[],
  content: OverlayContent,
  widthOf: (miniMessage: string) => number,
  heightOf: (asset: string) => number,
): { draws: OverlayDraw[]; missing: string[] } {
  const draws: OverlayDraw[] = [];
  const missing: string[] = [];
  layers.forEach((layer, index) => {
    if (layer.kind === "image") {
      draws.push({ image: true, content: layer.name, x: layer.x, rise: 0 - layer.y, layer: index });
    } else if (layer.kind === "image_slot") {
      const asset = content.images?.[layer.name];
      if (!asset) return;
      const height = layer.anchor === "bottom" ? heightOf(asset) : 0;
      if (height < 0) missing.push(asset);
      else
        draws.push({
          image: true,
          content: asset,
          x: layer.x,
          rise: overlaySlotRise(layer, height),
          layer: index,
        });
    } else if (layer.kind === "text") {
      const rows = content.text?.[layer.name] ?? [];
      for (let i = 0; i < Math.min(layer.lines, rows.length); i++) {
        const row = rows[i]!;
        if (!row) continue;
        const free = layer.width - widthOf(row);
        const dx =
          layer.align === "center" ? Math.trunc(free / 2) : layer.align === "right" ? free : 0;
        draws.push({
          image: false,
          content: row,
          x: layer.x + dx,
          rise: 0 - (layer.y + i * layer.row),
          layer: index,
        });
      }
    } else {
      const list = content.lists?.[layer.name];
      if (!list) return;
      for (let k = 0; k < layer.lines; k++) {
        const at = list.top + k;
        if (at < 0 || at >= list.rows.length) continue;
        const top = layer.y + k * layer.row;
        const row = list.rows[at]!;
        if (row)
          draws.push({ image: false, content: row, x: layer.x, rise: 0 - top, layer: index });
        if (at === list.selected && layer.cursor)
          draws.push({
            image: true,
            content: layer.cursor.image,
            x: layer.x + layer.cursor.x,
            rise: 0 - (top + layer.cursor.y),
            layer: index,
          });
      }
    }
  });
  return { draws, missing };
}

/**
 * The box a layer covers on screen, in GUI px from the slot's origin (y downwards): an image
 * at its size (`sizeOf`, 0×0 when unknown), a text or list at its width and lines.
 */
export function overlayLayerBox(
  layer: OverlayLayer,
  sizeOf: (asset: string) => { width: number; height: number } | undefined,
  slotAsset?: string,
): { x: number; y: number; width: number; height: number } {
  if (layer.kind === "text" || layer.kind === "list")
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.lines * layer.row };
  const size = sizeOf(layer.kind === "image" ? layer.name : (slotAsset ?? "")) ?? {
    width: 0,
    height: 0,
  };
  const top =
    layer.kind === "image_slot" && layer.anchor === "bottom" ? layer.y - size.height : layer.y;
  return { x: layer.x, y: top, width: size.width, height: size.height };
}
