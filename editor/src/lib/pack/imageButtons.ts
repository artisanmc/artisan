import { strToU8 } from "fflate";
import { parse } from "yaml";
import {
  type ImageButtonContainer,
  type ImageButtonImage,
  imageButtonArea,
  imageButtonGeometry,
} from "../../../../docs/schema/menu/v1/imageButtonGeometry";
import { sha256Hex } from "../sha256";
import type { AssetIndex } from "./assetIndexBuilder";
import { menuPaths } from "./menuPaths";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";

export interface ImageButtonPlacement extends ImageButtonImage {
  fit: NonNullable<ImageButtonImage["fit"]>;
  width: number;
  height: number;
  y: number;
}

export function imageButtonKey(button: ImageButtonPlacement): string {
  const hash = sha256Hex(new TextEncoder().encode(button.asset));
  const offsets =
    button.offset_x || button.offset_y ? `_${button.offset_x ?? 0}_${button.offset_y ?? 0}` : "";
  return `buttons/${hash}_${button.width}_${button.height}_${button.fit}_${button.y}${offsets}`;
}

export function imageButtonsFromMenus(
  files: { path: string; content: string }[],
): ImageButtonPlacement[] {
  const out: ImageButtonPlacement[] = [];
  const menus = menuPaths(files);
  for (const file of files) {
    if (!menus.has(file.path)) continue;
    // biome-ignore lint/suspicious/noExplicitAny: free-form YAML, read field by field
    let doc: any;
    try {
      doc = parse(file.content);
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object") continue;
    const type: ImageButtonContainer =
      doc.inventory_type === "hopper" || doc.inventory_type === "dropper"
        ? doc.inventory_type
        : "chest";
    const hidden = doc.player_inventory === "hidden";
    const size = Number(doc.size);
    if (!Number.isInteger(size) || size < 1 || size > 54) continue;
    const limit = size + (hidden ? 36 : 0);
    const elements = Array.isArray(doc.elements)
      ? doc.elements
      : Array.isArray(doc.layers)
        ? // biome-ignore lint/suspicious/noExplicitAny: idem
          doc.layers.flatMap((layer: any) => layer?.elements ?? [])
        : [];
    for (const el of elements) {
      if (!el || el.iterates || el.places) continue;
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
      // Same rectangle and origin as the editor and the plugin (imageButtonArea).
      const area = imageButtonArea([...slots], type, size, hidden);
      if (!area) continue;
      for (const app of [el, ...(Array.isArray(el.states) ? el.states : [])]) {
        if (typeof app?.image?.asset !== "string" || !app.image.asset) continue;
        if (
          app.image.fit !== undefined &&
          !["contain", "stretch", "native"].includes(app.image.fit)
        )
          continue;
        if (![app.image.offset_x ?? 0, app.image.offset_y ?? 0].every(Number.isSafeInteger))
          continue;
        out.push({
          asset: app.image.asset,
          fit: app.image.fit ?? "contain",
          ...(app.image.offset_x ? { offset_x: app.image.offset_x } : {}),
          ...(app.image.offset_y ? { offset_y: app.image.offset_y } : {}),
          width: area.width * 18,
          height: area.height * 18,
          y: area.y,
        });
      }
    }
  }
  return out;
}

/**
 * The image of a button as its slots show it: the source scaled by `fit`,
 * centred then offset, clipped to the button's rectangle. Shared by the Java
 * pack (a title glyph) and the Bedrock pack (an image over the slots).
 */
export function renderImageButton(
  input: RgbaImage,
  button: ImageButtonPlacement,
): { image: RgbaImage; contentWidth: number } {
  const output = createImage(button.width, button.height);
  const {
    width,
    height,
    x: dx,
    y: dy,
  } = imageButtonGeometry(button, input.width, input.height, button.width, button.height);
  let contentWidth = 0;
  for (let y = Math.max(0, -dy); y < Math.min(height, button.height - dy); y++)
    for (let x = Math.max(0, -dx); x < Math.min(width, button.width - dx); x++) {
      const src =
        (Math.floor((y * input.height) / height) * input.width +
          Math.floor((x * input.width) / width)) *
        4;
      const dest = ((y + dy) * button.width + x + dx) * 4;
      output.data.set(input.data.subarray(src, src + 4), dest);
      if (input.data[src + 3]) contentWidth = Math.max(contentWidth, x + dx + 1);
    }
  return { image: output, contentWidth };
}

export function buildImageButtons(
  files: Record<string, Uint8Array>,
  index: AssetIndex,
  pngs: Map<string, Uint8Array>,
  placements: ImageButtonPlacement[],
) {
  if (placements.length) {
    files["assets/artisan/items/buttons/hit_area.json"] = strToU8(
      JSON.stringify({ model: { type: "minecraft:empty" } }),
    );
  }
  for (const button of placements) {
    const key = imageButtonKey(button);
    if (index.assets[key]) continue;
    const source = pngs.get(button.asset);
    if (!source) continue;
    const { image: output, contentWidth } = renderImageButton(decodePng(source), button);
    files[`assets/artisan/textures/${key}.png`] = encodePng(output);
    const ascent = 13 - button.y;
    files[`assets/artisan/font/${key}.json`] = strToU8(
      JSON.stringify({
        providers: [
          {
            type: "bitmap",
            file: `artisan:${key}.png`,
            height: button.height,
            ascent,
            chars: ["\ue000"],
          },
        ],
      }),
    );
    index.assets[key] = {
      name: key,
      type: "glyph",
      codepoint: 0xe000,
      ascent,
      height: button.height,
      width: contentWidth,
      namespace: `artisan:${key}`,
    };
  }
}
