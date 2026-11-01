import { strToU8, zipSync } from "fflate";
import { sha1Hex } from "../../sha1";
import { sha256Hex } from "../../sha256";
import type { AssetRow } from "../fontJsonBuilder";
import { type ImageButtonPlacement, imageButtonKey, renderImageButton } from "../imageButtons";
import { type RgbaImage, bitblt, createImage, decodePng, encodePng } from "../png";
import type { BedrockMenu } from "./bedrockMenus";
import { backgroundTexture, buildChestScreen, buttonTexture, panelRows } from "./bedrockUi";

/**
 * The Bedrock resource pack of a server (`.mcpack`): for each styled menu, a
 * composed background, the images of its buttons and the screen file that
 * places them (bedrockUi.ts). Geyser hands it to Bedrock players; the plugin
 * registers it per session (`GeyserIntegration`).
 *
 * Identity: the pack uuid comes from the server id and its version from its
 * content, so a client re-downloads exactly when the pack changes.
 */
export interface BedrockPackInput {
  serverId: string;
  menus: BedrockMenu[];
  /** PNG bytes by asset name, across the server's Projects (first one wins). */
  pngs: Map<string, Uint8Array>;
  /** Asset rows: a background sits at `13 - ascent`, like a title glyph. */
  assets: AssetRow[];
  /** The vanilla `generic_54.png` (or the server's restyled one, same layout). */
  chestTexture: Uint8Array;
}

export interface BedrockPackResult {
  bytes: Uint8Array;
  hash: string;
  /** Files of the pack, for tests and inspection. */
  files: Record<string, Uint8Array>;
}

const WIDTH = 176;
const TITLE_H = 17;
const ROW_H = 18;
const GLYPH_Y_BASE = 13;
/** A plain row of the chest texture (left border, grey, right border), just under the slot rows. */
const FILL_Y = 126;
const ZIP_MTIME = () => new Date(2020, 0, 1, 0, 0, 0);

/** `src` composited over `dst` at (dx, dy), straight alpha. */
function blend(src: RgbaImage, dst: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      const sa = (src.data[s + 3] as number) / 255;
      if (sa === 0) continue;
      const da = (dst.data[d + 3] as number) / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        const sv = src.data[s + c] as number;
        const dv = dst.data[d + c] as number;
        dst.data[d + c] = Math.round((sv * sa + dv * da * (1 - sa)) / oa);
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

function scaleOf(png: RgbaImage): number {
  return png.width === png.height && png.width >= 256 && png.width % 256 === 0
    ? png.width / 256
    : 1;
}

/**
 * The top of the vanilla chest window (title bar and slot rows), at 1x, as tall as
 * the Bedrock screen's top half: below a menu's own rows, a plain band of the
 * texture covers the slots Geyser fills to reach 3 or 6 rows.
 */
function chestTop(texture: Uint8Array, rows: number): RgbaImage {
  const src = decodePng(texture);
  const k = scaleOf(src);
  const own = TITLE_H + rows * ROW_H;
  const h = TITLE_H + panelRows(rows) * ROW_H;
  const out = createImage(WIDTH, h);
  // Nearest-neighbour down to the pack's pixel grid when the texture is HD.
  for (let y = 0; y < h; y++) {
    const sy = (y < own ? y : FILL_Y) * k;
    for (let x = 0; x < WIDTH; x++)
      out.data.set(
        src.data.subarray((sy * src.width + x * k) * 4, (sy * src.width + x * k) * 4 + 4),
        (y * WIDTH + x) * 4,
      );
  }
  return out;
}

interface Placed {
  image: RgbaImage;
  x: number;
  y: number;
}

/** The menu's image layers, decoded and positioned in chest pixels. */
function placedImages(menu: BedrockMenu, input: BedrockPackInput): Placed[] {
  const out: Placed[] = [];
  for (const layer of menu.images) {
    const bytes = input.pngs.get(layer.asset);
    if (!bytes) continue;
    let image: RgbaImage;
    try {
      image = decodePng(bytes);
    } catch {
      continue;
    }
    const row = input.assets.find((a) => a.id === layer.asset);
    // A background sits at its asset's ascent; a glyph at its own Y, floored
    // like the Java pack (MC refuses ascent > height).
    const y =
      layer.y === null
        ? GLYPH_Y_BASE - (row?.ascent ?? GLYPH_Y_BASE - TITLE_H)
        : Math.max(layer.y, GLYPH_Y_BASE - image.height);
    out.push({ image, x: layer.x, y });
  }
  return out;
}

/** The composed background of a menu: the vanilla top (unless transparent), then its image layers. */
function composeBackground(menu: BedrockMenu, input: BedrockPackInput): RgbaImage {
  const layers = placedImages(menu, input);
  const top = menu.transparent ? null : chestTop(input.chestTexture, menu.rows);
  const height = Math.max(1, top?.height ?? 0, ...layers.map((l) => l.y + l.image.height));
  const out = createImage(WIDTH, height);
  if (top) bitblt(top, out, 0, 0, top.width, top.height, 0, 0);
  for (const l of layers) blend(l.image, out, l.x, l.y);
  return out;
}

function placement(button: BedrockMenu["buttons"][number], state: number): ImageButtonPlacement {
  const image = button.images.find(
    (i) => i.state === state,
  ) as BedrockMenu["buttons"][number]["images"][number];
  return {
    asset: image.asset,
    fit: image.fit,
    ...(image.offset_x ? { offset_x: image.offset_x } : {}),
    ...(image.offset_y ? { offset_y: image.offset_y } : {}),
    width: button.width,
    height: button.height,
    y: button.y,
  };
}

function uuidOf(seed: string): string {
  const h = sha256Hex(new TextEncoder().encode(seed));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function buildBedrockPack(input: BedrockPackInput): BedrockPackResult {
  const files: Record<string, Uint8Array> = {};
  const backgrounds = new Map<string, RgbaImage>();
  for (const menu of input.menus) {
    const png = composeBackground(menu, input);
    backgrounds.set(menu.key, png);
    files[`${backgroundTexture(menu)}.png`] = encodePng(png);
  }
  const buttonKeys = new Map<string, string>();
  const keyOf = (menu: BedrockMenu, button: BedrockMenu["buttons"][number], state: number) => {
    const id = `${menu.key}/${button.index}/${state}`;
    const known = buttonKeys.get(id);
    if (known) return known;
    const key = imageButtonKey(placement(button, state));
    buttonKeys.set(id, key);
    const path = `${buttonTexture(key)}.png`;
    const source = input.pngs.get(placement(button, state).asset);
    if (!files[path] && source) {
      try {
        files[path] = encodePng(
          renderImageButton(decodePng(source), placement(button, state)).image,
        );
      } catch {
        // Unreadable PNG: the Java pack skips it the same way.
      }
    }
    return key;
  };
  // Buttons whose image is missing keep their element: Bedrock then shows
  // nothing where Java shows a missing glyph.
  const menus = input.menus.map((menu) => ({
    ...menu,
    buttons: menu.buttons.map((b) => ({
      ...b,
      images: b.images.filter((i) => input.pngs.has(i.asset)),
    })),
  }));
  const screen = buildChestScreen(
    menus,
    (menu) => (backgrounds.get(menu.key) as RgbaImage).height,
    keyOf,
  );
  files["ui/chest_screen.json"] = strToU8(JSON.stringify(screen, null, 2));
  files["textures/item_texture.json"] = strToU8(
    JSON.stringify(
      {
        resource_pack_name: "artisan",
        texture_name: "atlas.items",
        texture_data: { artisan_hit_area: { textures: ["textures/items/artisan_hit_area"] } },
      },
      null,
      2,
    ),
  );
  // The transparent icon of the click item under an image button, and the
  // glyph page of the title's control characters, drawn blank.
  files["textures/items/artisan_hit_area.png"] = encodePng(createImage(16, 16));
  files["font/glyph_F8.png"] = encodePng(createImage(256, 256));

  const parts = Object.keys(files)
    .sort()
    .flatMap((path) => [strToU8(path), files[path] as Uint8Array]);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  const digest = sha256Hex(all);
  const version = [
    1,
    Number.parseInt(digest.slice(0, 4), 16),
    Number.parseInt(digest.slice(4, 8), 16),
  ];
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format_version: 2,
        header: {
          name: "Artisan menus",
          description: "Menus styled by Artisan, for Bedrock players",
          uuid: uuidOf(`artisan-bedrock:${input.serverId}`),
          version,
          min_engine_version: [1, 20, 0],
        },
        modules: [
          { type: "resources", uuid: uuidOf(`artisan-bedrock-module:${input.serverId}`), version },
        ],
      },
      null,
      2,
    ),
  );
  const bytes = zipSync(files, { level: 0, mtime: ZIP_MTIME() });
  return { bytes, hash: sha1Hex(bytes), files };
}
