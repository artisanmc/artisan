import { parse } from "yaml";
import {
  type ImageButtonContainer,
  imageButtonArea,
  labelFrame,
  lookLabels,
} from "../../../../docs/schema/menu/v1/imageButtonGeometry";
import { minYForSize } from "./fontJsonBuilder";
import { menuPaths } from "./menuPaths";

/** A title text of `size` whose top sits at chest `y`: one `text_y{y}_h{size}` font. */
export interface TextPlacement {
  y: number;
  size: number;
}

export const TEXT_SIZES = [8, 12, 16, 20, 24, 32] as const;
/** Lowest chest Y a text font exists for (`TitleCompiler.TEXT_Y_MAX`). */
export const TEXT_Y_MAX = 172;
/** Beyond this a Y is out of any window anyway; keeps the line arithmetic exact. */
const Y_BOUND = 100000;

type Yaml = Record<string, unknown>;

const isMap = (v: unknown): v is Yaml => typeof v === "object" && v !== null && !Array.isArray(v);

/** A YAML number as the plugin's `toInt()` reads it; anything else is 0. */
function int(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(-Y_BOUND, Math.min(Y_BOUND, Math.trunc(v)));
}

/** `MenuTitleParser.parseSize`: a size out of the set is 8. */
function sizeOf(v: unknown): number {
  const n = int(v);
  return (TEXT_SIZES as readonly number[]).includes(n) ? n : 8;
}

/** A one-line text: its Y, clamped as `TitleCompiler` clamps it. */
function pushText(out: TextPlacement[], y: number, size: number) {
  out.push({ y: Math.max(minYForSize(size), Math.min(TEXT_Y_MAX, y)), size });
}

/**
 * A text block: every line it may draw down to the bottom of the window, since how many it
 * has depends on the player (placeholders, language). Lines above the floor are drawn at it.
 */
function pushBlock(out: TextPlacement[], y: number, size: number, lineHeight: number) {
  if (y > TEXT_Y_MAX) return;
  const floor = minYForSize(size);
  let first = y;
  if (y < floor) {
    out.push({ y: floor, size });
    first = y + Math.floor((floor - y + lineHeight - 1) / lineHeight) * lineHeight;
  }
  for (let line = first; line <= TEXT_Y_MAX; line += lineHeight) out.push({ y: line, size });
}

/**
 * The (Y, size) of every text a Project's menus may draw in a title: `text` and `textarea`
 * layers, and the labels of fixed elements. The resource pack emits a `text_y{Y}_h{H}` font
 * for these only (plus every Y at size 8, which `api.getOverlay().raise` also uses).
 * An unreadable menu is skipped: the plugin will not render it either.
 */
export function textPlacementsFromMenus(
  files: { path: string; content: string }[],
  /** A menu as it is drawn: its components put in (`components.ts`). */
  expand: (menu: unknown) => unknown = (menu) => menu,
): TextPlacement[] {
  const out: TextPlacement[] = [];
  const menus = menuPaths(files);
  for (const file of files) {
    if (!menus.has(file.path)) continue;
    let doc: unknown;
    try {
      doc = expand(parse(file.content));
    } catch {
      continue;
    }
    if (!isMap(doc)) continue;
    pushTitle(out, doc.title);
    pushLabels(out, doc);
  }
  return out;
}

function pushTitle(out: TextPlacement[], title: unknown) {
  const layers = Array.isArray(title) ? title : isMap(title) ? [title] : [];
  for (const layer of layers) {
    if (!isMap(layer)) continue;
    if (layer.kind === "text") pushText(out, int(layer.y), sizeOf(layer.size));
    else if (layer.kind === "textarea") {
      const lineHeight =
        typeof layer.line_height === "number"
          ? Math.max(1, Math.min(32, int(layer.line_height)))
          : 10;
      pushBlock(out, int(layer.y), sizeOf(layer.size), lineHeight);
    }
  }
}

/** Labels of fixed elements, over the same rectangle as an image button (`imageButtons.ts`). */
function pushLabels(out: TextPlacement[], doc: Yaml) {
  const type: ImageButtonContainer =
    doc.inventory_type === "hopper" || doc.inventory_type === "dropper"
      ? doc.inventory_type
      : "chest";
  const hidden = doc.player_inventory === "hidden";
  const size = Number(doc.size);
  if (!Number.isInteger(size) || size < 1 || size > 54) return;
  const limit = size + (hidden ? 36 : 0);
  const elements: unknown[] = Array.isArray(doc.elements)
    ? doc.elements
    : Array.isArray(doc.layers)
      ? doc.layers.flatMap((layer: unknown) => {
          const e = isMap(layer) ? layer.elements : undefined;
          return e === undefined || e === null ? [] : Array.isArray(e) ? e : [e];
        })
      : [];
  for (const el of elements) {
    if (!isMap(el) || el.iterates || el.places) continue;
    const appearances = [el, ...(Array.isArray(el.states) ? el.states : [])];
    const labels = appearances.flatMap(lookLabels).filter(isMap);
    if (!labels.length) continue;
    const slots = new Set<number>();
    let valid = true;
    for (const part of String(el.positions ?? "").split(",")) {
      const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!match) {
        valid = false;
        break;
      }
      const a = Number(match[1]);
      const b = Number(match[2] ?? a);
      if (a >= limit || b >= limit) {
        valid = false;
        break;
      }
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) slots.add(i);
    }
    if (!valid || !slots.size) continue;
    const area = imageButtonArea([...slots], type, size, hidden);
    if (!area) continue;
    for (const label of labels) {
      const frame = labelFrame(
        {
          size: sizeOf(label.size) as 8,
          offset_y: int(label.offset_y),
          valign: label.valign === "top" || label.valign === "bottom" ? label.valign : "center",
        },
        { x: 0, y: Math.trunc(area.y), width: area.width * 18, height: area.height * 18 },
      );
      pushBlock(out, frame.y, frame.size, frame.lineHeight);
    }
  }
}
