import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PNG } from "pngjs";
import { strFromU8, unzipSync } from "fflate";
import { buildResourcePackZip } from "./resourcePackBuilder";
import {
  GENERIC_54_OVERRIDE,
  VANILLA_GUI_FONT,
  buildVanillaGuiFiles,
  transparentChestsFromMenus,
} from "./vanillaGui";

const source = new Uint8Array(
  readFileSync(resolve(import.meta.dir, "../../../editor/src/assets/minecraft/generic_54.png")),
);

describe("transparentChestsFromMenus", () => {
  test("true only when a chest menu turns its vanilla texture off", () => {
    const menu = (body: string) => ({ path: "menus/m.yaml", content: `id: m\nsize: 27\n${body}` });
    expect(transparentChestsFromMenus([menu("")])).toBe(false);
    expect(transparentChestsFromMenus([menu("vanilla_texture: true\n")])).toBe(false);
    expect(transparentChestsFromMenus([menu("vanilla_texture: false\n")])).toBe(true);
    expect(transparentChestsFromMenus([menu("inventory_type: hopper\nvanilla_texture: false\n")])).toBe(false);
    expect(
      transparentChestsFromMenus([{ path: "commands/c.yaml", content: "vanilla_texture: false\n" }]),
    ).toBe(false);
    expect(transparentChestsFromMenus([{ path: "menus/broken.yaml", content: "title: [" }])).toBe(false);
  });
});

describe("buildVanillaGuiFiles", () => {
  const files = buildVanillaGuiFiles(source, false);

  test("one glyph per chest height, cut like vanilla ChestScreen", () => {
    for (let rows = 1; rows <= 6; rows++) {
      const png = PNG.sync.read(Buffer.from(files[`assets/artisan/textures/gui/generic_9x${rows}.png`]!));
      expect(png.width).toBe(176);
      expect(png.height).toBe(17 + rows * 18 + 96);
    }
    // Top of the first player inventory slot: texture row 139, drawn after the chest rows.
    const three = PNG.sync.read(Buffer.from(files["assets/artisan/textures/gui/generic_9x3.png"]!));
    const src = PNG.sync.read(Buffer.from(source));
    const px = (p: PNG, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
    expect(px(three, 7, 17 + 3 * 18 + (139 - 126))).toEqual(px(src, 7, 139));
  });

  test("the font draws each glyph from the window's top-left and walks back to the title origin", () => {
    const font = JSON.parse(strFromU8(files[VANILLA_GUI_FONT]!)) as {
      providers: { type: string; file?: string; ascent?: number; height?: number; chars?: string[]; advances?: Record<string, number> }[];
    };
    const bitmaps = font.providers.filter((p) => p.type === "bitmap");
    expect(bitmaps).toHaveLength(6);
    expect(bitmaps[2]).toEqual({
      type: "bitmap",
      file: "artisan:gui/generic_9x3.png",
      ascent: 13,
      height: 17 + 3 * 18 + 96,
      chars: [String.fromCodePoint(0xe003)],
    });
    const space = font.providers.find((p) => p.type === "space")!;
    expect(space.advances![String.fromCodePoint(0xe010)]).toBe(-8);
    // Bitmap advance = content width + 1 ; back to x=8 after starting at x=0.
    expect(space.advances![String.fromCodePoint(0xe013)]).toBe(-(176 + 1) + 8);
  });

  test("the vanilla chest texture is only overridden when asked", () => {
    expect(files[GENERIC_54_OVERRIDE]).toBeUndefined();
    const transparent = buildVanillaGuiFiles(source, true)[GENERIC_54_OVERRIDE]!;
    const png = PNG.sync.read(Buffer.from(transparent));
    expect([png.width, png.height]).toEqual([256, 256]);
    expect(png.data.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });
});

describe("buildResourcePackZip vanilla GUI", () => {
  test("ships the GUI font and flags transparent chests in the asset index", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map(), undefined, [], [], {
      source,
      transparentChests: true,
    });
    const zip = unzipSync(zipBytes);
    expect(zip[VANILLA_GUI_FONT]).toBeDefined();
    expect(zip[GENERIC_54_OVERRIDE]).toBeDefined();
    const index = JSON.parse(strFromU8(zip["assets/artisan/asset-index.json"]!));
    expect(index.vanilla_gui).toEqual({ transparent_chests: true });
  });

  test("without a source the pack is unchanged", () => {
    const zip = unzipSync(buildResourcePackZip([], new Map(), new Map()).zipBytes);
    expect(zip[VANILLA_GUI_FONT]).toBeUndefined();
    expect(JSON.parse(strFromU8(zip["assets/artisan/asset-index.json"]!)).vanilla_gui).toBeUndefined();
  });
});
