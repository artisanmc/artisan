import { classifyDocumentLayout } from "@/domain/documentLayout";
import { parse } from "yaml";
import {
  type ImageButtonImage,
  PART_ANCHORS,
  imageButtonArea,
  lookImages,
} from "../../../../../docs/schema/menu/v1/imageButtonGeometry";
import { BUTTON_MAX, STATE_MAX, TEXTAREA_FIELD, TEXT_FIELD, bedrockMenuKey } from "./bedrockTitle";

const MENU_DIRS: ReadonlySet<string> = new Set(["menus"]);

/** One appearance of an image button that draws an image (default or state). */
export interface BedrockButtonImage extends ImageButtonImage {
  /** Index among `[default, ...states]`; appearances without an image are skipped. */
  state: number;
  fit: NonNullable<ImageButtonImage["fit"]>;
}

export interface BedrockButton {
  index: number;
  /** Image rectangle, chest pixels: origin of the covered slots and their size. */
  x: number;
  y: number;
  width: number;
  height: number;
  images: BedrockButtonImage[];
}

export interface BedrockTextLayer {
  index: number;
  /** Characters the plugin pads the field to. */
  length: number;
  x: number;
  y: number;
  /** Bedrock label scale: layer size / 8. */
  scale: number;
  /** `#rrggbb`, or a MiniMessage color name. */
  color?: string;
  /** Textarea only. */
  width?: number;
  alignment?: "left" | "center" | "right";
}

/** A menu the Bedrock pack styles: what its screen shows besides the items. */
export interface BedrockMenu {
  projectId: string;
  id: string;
  key: string;
  rows: 1 | 2 | 3 | 4 | 5 | 6;
  /** `vanilla_texture` off: no vanilla chest top under its background. */
  transparent: boolean;
  /** Background and glyph layers in title order; a background has no position. */
  images: { asset: string; x: number; y: number | null }[];
  texts: BedrockTextLayer[];
  buttons: BedrockButton[];
}

/** MC default chest title position (AbstractContainerScreen.titleLabelX/Y). */
const PLAIN_X = 8;
const PLAIN_Y = 6;

function slotsOf(positions: unknown, limit: number): number[] | null {
  const slots = new Set<number>();
  for (const part of String(positions ?? "").split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) return null;
    const a = Number(match[1]);
    const b = Number(match[2] ?? a);
    if (a >= limit || b >= limit) return null;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) slots.add(i);
  }
  return slots.size ? [...slots] : null;
}

/** An element whose positions all fall in the chest (no placement, whose slots are free). */
// biome-ignore lint/suspicious/noExplicitAny: free-form YAML, read field by field
function inChest(el: any, size: number): boolean {
  if (!el || typeof el !== "object") return true;
  if (el.places !== undefined && el.places !== null) return false;
  const spec = String(el.positions ?? "");
  return (spec.match(/\d+/g) ?? []).every((n) => Number(n) < size);
}

// biome-ignore lint/suspicious/noExplicitAny: free-form YAML, read field by field
function imageOf(app: any): ImageButtonImage | null {
  // A look of several pieces shows its first image here (the bottom one).
  // biome-ignore lint/suspicious/noExplicitAny: idem
  const image = lookImages(app)[0] as any;
  if (typeof image?.asset !== "string" || !image.asset) return null;
  if (image.fit !== undefined && !["contain", "stretch", "native"].includes(image.fit)) return null;
  if (![image.offset_x ?? 0, image.offset_y ?? 0].every(Number.isSafeInteger)) return null;
  if (image.anchor !== undefined && !PART_ANCHORS.includes(image.anchor)) return null;
  return {
    asset: image.asset,
    fit: image.fit ?? "contain",
    ...(image.offset_x ? { offset_x: image.offset_x } : {}),
    ...(image.offset_y ? { offset_y: image.offset_y } : {}),
    ...(image.anchor && image.anchor !== "center" ? { anchor: image.anchor } : {}),
  };
}

/**
 * The color tag a value opens with (`<white>…`, `<#ff8800>…`, `<color:gold>…`): the
 * plugin sends Bedrock the text without its tags, so the label takes that color.
 */
export function leadingColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^\s*<(?:color:|c:)?(#[0-9a-fA-F]{6}|[a-z_]+)>/.exec(value);
  return match?.[1];
}

function textLayers(title: unknown): BedrockTextLayer[] {
  const out: BedrockTextLayer[] = [];
  const layers = Array.isArray(title) ? title : title ? [title] : [];
  for (const layer of layers) {
    // A bare string entry is a plain layer (MenuTitleParser.parseLayers).
    const l = typeof layer === "string" ? { kind: "plain", value: layer } : layer;
    if (!l || typeof l !== "object") continue;
    const kind = (l as { kind?: unknown }).kind;
    if (kind !== "text" && kind !== "plain" && kind !== "textarea") continue;
    const t = l as Record<string, unknown>;
    const index = out.length;
    const size = typeof t.size === "number" && t.size > 0 ? t.size : 8;
    const color = typeof t.color === "string" ? t.color : leadingColor(t.value);
    if (kind === "plain") {
      out.push({ index, length: TEXT_FIELD, x: PLAIN_X, y: PLAIN_Y, scale: 1, color });
      continue;
    }
    if (typeof t.x !== "number" || typeof t.y !== "number") continue;
    // A custom font cannot travel to Bedrock: the layer renders in the default font.
    if (kind === "text") {
      out.push({ index, length: TEXT_FIELD, x: t.x, y: t.y, scale: size / 8, color });
      continue;
    }
    const alignment = ["left", "center", "right"].includes(String(t.alignment))
      ? (t.alignment as BedrockTextLayer["alignment"])
      : "left";
    out.push({
      index,
      length: TEXTAREA_FIELD,
      x: t.x,
      y: t.y,
      scale: size / 8,
      color,
      width: typeof t.width === "number" ? t.width : 160,
      alignment,
    });
  }
  return out;
}

/**
 * The menus of a Project the Bedrock pack can style: chests of 1 to 6 rows (Geyser
 * shows 1 to 3 rows on the small chest screen and 4 to 6 on the large one, the two
 * Bedrock screens the pack modifies). Any other menu reaches Bedrock
 * players as the chest Geyser translates, without a key in its title.
 * An unreadable menu is skipped — the plugin will not render it either.
 */
export function bedrockMenusFromProject(
  projectId: string,
  files: { path: string; content: string }[],
  /** The id of the image a name of these files is (`imageNames.ts`). */
  resolve: (ref: string) => string = (ref) => ref,
  /** A menu as it is drawn: its components put in (`components.ts`). */
  expand: (menu: unknown) => unknown = (menu) => menu,
): BedrockMenu[] {
  const out: BedrockMenu[] = [];
  // The id is the file name, wherever the menu sits (themed folders included), as the
  // plugin reads it: a `id:` field in the file is ignored there, and the editor drops it.
  // A variant's menu gets its own key: the plugin sends it for that variant only.
  const layout = classifyDocumentLayout(
    files.map((f) => f.path),
    MENU_DIRS,
  );
  const docs = new Map([...layout.documents, ...layout.variants].map((d) => [d.path, d]));
  for (const file of files) {
    const entry = docs.get(file.path);
    if (entry === undefined) continue;
    const id = entry.id;
    // biome-ignore lint/suspicious/noExplicitAny: free-form YAML, read field by field
    let doc: any;
    try {
      doc = expand(parse(file.content));
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object") continue;
    if (doc.inventory_type !== undefined && doc.inventory_type !== "chest") continue;
    const size = Number(doc.size);
    if (!Number.isInteger(size) || size % 9 !== 0 || size < 9 || size > 54) continue;
    const rows = (size / 9) as BedrockMenu["rows"];
    const elements = Array.isArray(doc.elements)
      ? doc.elements
      : Array.isArray(doc.layers)
        ? // biome-ignore lint/suspicious/noExplicitAny: idem
          doc.layers.flatMap((layer: any) => layer?.elements ?? [])
        : [];
    // Player inventory hidden: only drawn without the vanilla texture (its background covers
    // the top; Bedrock's own inventory stays below, empty) and with every element in the
    // chest — buttons placed in the inventory are not drawn yet. Same rule as the plugin's `BedrockTitle.supports`.
    if (
      doc.player_inventory === "hidden" &&
      (doc.vanilla_texture !== false || !elements.every((el: unknown) => inChest(el, size)))
    )
      continue;

    const images: BedrockMenu["images"] = [];
    const title = Array.isArray(doc.title) ? doc.title : doc.title ? [doc.title] : [];
    for (const layer of title) {
      if (!layer || typeof layer !== "object") continue;
      const named = typeof layer.asset === "string" ? layer.asset : layer.asset_id;
      if (typeof named !== "string") continue;
      const asset = resolve(named);
      if (layer.kind === "background") images.push({ asset, x: 0, y: null });
      if (layer.kind === "glyph" && typeof layer.x === "number" && typeof layer.y === "number")
        images.push({ asset, x: layer.x, y: layer.y });
    }

    const buttons: BedrockButton[] = [];
    for (const el of elements) {
      if (!el || el.iterates || el.places) continue;
      const apps = [el, ...(Array.isArray(el.states) ? el.states : [])];
      if (!apps.some((app) => lookImages(app).length)) continue;
      const slots = slotsOf(el.positions, size);
      const area = slots && imageButtonArea(slots, "chest", size, false);
      if (!area || buttons.length >= BUTTON_MAX) continue;
      const images: BedrockButtonImage[] = [];
      apps.forEach((app, state) => {
        const image = imageOf(app);
        if (image && state < STATE_MAX)
          images.push({
            ...image,
            asset: resolve(image.asset),
            state,
            fit: image.fit ?? "contain",
          });
      });
      buttons.push({
        index: buttons.length,
        x: area.x,
        y: area.y,
        width: area.width * 18,
        height: area.height * 18,
        images,
      });
    }

    out.push({
      projectId,
      id,
      key: bedrockMenuKey(projectId, id, entry.variant),
      rows,
      transparent: doc.vanilla_texture === false,
      images,
      texts: textLayers(doc.title),
      buttons,
    });
  }
  return out;
}
