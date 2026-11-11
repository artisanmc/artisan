// @vitest-environment node

import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";
import { buildResourcePackZip } from "./resourcePackBuilder";
import {
  GUI_OVERRIDES,
  type GuiContainer,
  VANILLA_GUI_FONT,
  buildVanillaGuiFiles,
  containerTextureSource,
  transparentContainersFromMenus,
} from "./vanillaGui";

const read = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../assets/minecraft/${name}.png`, import.meta.url)));
const sources: Record<GuiContainer, Uint8Array> = {
  chest: read("generic_54"),
  hopper: read("hopper"),
  dispenser: read("dispenser"),
};
const none = new Set<GuiContainer>();

type Font = {
  providers: {
    type: string;
    file?: string;
    ascent?: number;
    height?: number;
    chars?: string[];
    advances?: Record<string, number>;
  }[];
};
const font = (files: Record<string, Uint8Array>) =>
  JSON.parse(strFromU8(files[VANILLA_GUI_FONT]!)) as Font;
const cp = (n: number) => String.fromCodePoint(n);

describe("transparentContainersFromMenus", () => {
  test("collects the containers whose menus turn their vanilla texture off", () => {
    const menu = (body: string, id = "m") => ({
      path: `menus/${id}.yaml`,
      content: `size: 27\n${body}`,
    });
    expect(transparentContainersFromMenus([menu("")])).toEqual(none);
    expect(transparentContainersFromMenus([menu("vanilla_texture: true\n")])).toEqual(none);
    expect(transparentContainersFromMenus([menu("vanilla_texture: false\n")])).toEqual(
      new Set(["chest"]),
    );
    expect(
      transparentContainersFromMenus([
        menu("inventory_type: hopper\nvanilla_texture: false\n"),
        menu("inventory_type: dropper\nvanilla_texture: false\n", "d"),
      ]),
    ).toEqual(new Set(["hopper", "dispenser"]));
    expect(
      transparentContainersFromMenus([
        { path: "commands/c.yaml", content: "vanilla_texture: false\n" },
      ]),
    ).toEqual(none);
    expect(
      transparentContainersFromMenus([{ path: "menus/broken.yaml", content: "title: [" }]),
    ).toEqual(none);
    // A themed folder and a variant count, as the plugin loads them; twin ids do not.
    const off = "inventory_type: hopper\nvanilla_texture: false\n";
    expect(
      transparentContainersFromMenus([
        { path: "shop/menus/h.yml", content: off },
        { path: "variants.yml", content: "rules: []\n" },
        { path: "variants/textured/menus/d.yml", content: off.replace("hopper", "dropper") },
      ]),
    ).toEqual(new Set(["hopper", "dispenser"]));
    expect(
      transparentContainersFromMenus([
        { path: "menus/h.yml", content: off },
        { path: "menus/h.yaml", content: off },
      ]),
    ).toEqual(none);
  });
});

describe("buildVanillaGuiFiles", () => {
  const files = buildVanillaGuiFiles(sources, none);

  test("one chest glyph per height, cut like vanilla ChestScreen", () => {
    for (let rows = 1; rows <= 6; rows++) {
      const png = decodePng(files[`assets/artisan/textures/gui/generic_9x${rows}.png`]!);
      expect([png.width, png.height]).toEqual([176, 17 + rows * 18 + 96]);
    }
    // Top of the first player inventory slot: texture row 139, drawn after the chest rows.
    const three = decodePng(files["assets/artisan/textures/gui/generic_9x3.png"]!);
    const src = decodePng(sources.chest);
    const px = (p: RgbaImage, x: number, y: number) => [
      ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4),
    ];
    expect(px(three, 7, 17 + 3 * 18 + (139 - 126))).toEqual(px(src, 7, 139));
  });

  test("the hopper and dispenser windows are one glyph each, their full vanilla box", () => {
    for (const [name, height] of [
      ["hopper", 133],
      ["dispenser", 166],
    ] as const) {
      const png = decodePng(files[`assets/artisan/textures/gui/${name}.png`]!);
      expect([png.width, png.height]).toEqual([176, height]);
    }
  });

  test("the font draws each glyph from the window's top-left and walks back to the title origin", () => {
    const { providers } = font(files);
    const bitmaps = providers.filter((p) => p.type === "bitmap");
    expect(bitmaps).toHaveLength(8);
    expect(bitmaps[2]).toEqual({
      type: "bitmap",
      file: "artisan:gui/generic_9x3.png",
      ascent: 13,
      height: 17 + 3 * 18 + 96,
      chars: [cp(0xe003)],
    });
    expect(bitmaps[6]).toMatchObject({
      file: "artisan:gui/hopper.png",
      height: 133,
      chars: [cp(0xe007)],
    });
    expect(bitmaps[7]).toMatchObject({
      file: "artisan:gui/dispenser.png",
      height: 166,
      chars: [cp(0xe008)],
    });
    const space = providers.find((p) => p.type === "space")!;
    expect(space.advances![cp(0xe010)]).toBe(-8);
    // Bitmap advance = content width + 1 ; back to x=8 after starting at x=0.
    expect(space.advances![cp(0xe013)]).toBe(-(176 + 1) + 8);
    expect(space.advances![cp(0xe017)]).toBe(-(176 + 1) + 8);
    expect(space.advances![cp(0xe018)]).toBe(-(176 + 1) + 8);
  });

  test("a vanilla texture is only overridden for the containers asked", () => {
    for (const path of Object.values(GUI_OVERRIDES)) expect(files[path]).toBeUndefined();
    const hopperOnly = buildVanillaGuiFiles(sources, new Set(["hopper"]));
    expect(hopperOnly[GUI_OVERRIDES.chest]).toBeUndefined();
    expect(hopperOnly[GUI_OVERRIDES.dispenser]).toBeUndefined();
    const png = decodePng(hopperOnly[GUI_OVERRIDES.hopper]!);
    expect([png.width, png.height]).toEqual([256, 256]);
    expect(png.data.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });
});

describe("buildResourcePackZip vanilla GUI", () => {
  test("ships the GUI font and flags each transparent container in the asset index", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map(), undefined, [], [], {
      sources,
      transparent: new Set(["chest", "dispenser"]),
    });
    const zip = unzipSync(zipBytes);
    expect(zip[VANILLA_GUI_FONT]).toBeDefined();
    expect(zip[GUI_OVERRIDES.chest]).toBeDefined();
    expect(zip[GUI_OVERRIDES.dispenser]).toBeDefined();
    const index = JSON.parse(strFromU8(zip["assets/artisan/asset-index.json"]!));
    expect(index.vanilla_gui).toEqual({
      transparent_chests: true,
      transparent_hoppers: false,
      transparent_dispensers: true,
    });
  });

  test("without sources the pack is unchanged", () => {
    const zip = unzipSync(buildResourcePackZip([], new Map(), new Map()).zipBytes);
    expect(zip[VANILLA_GUI_FONT]).toBeUndefined();
    expect(
      JSON.parse(strFromU8(zip["assets/artisan/asset-index.json"]!)).vanilla_gui,
    ).toBeUndefined();
  });
});

/** A texture scaled up `k` times, like an HD resource pack's. */
function upscaled(bytes: Uint8Array, k: number): Uint8Array {
  const src = decodePng(bytes);
  const out = createImage(src.width * k, src.height * k);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
      out.data.set(src.data.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  return encodePng(out);
}

describe("custom container textures", () => {
  const png = (w: number, h: number) => encodePng(createImage(w, h));
  const asset = (ref: string, bytes: Uint8Array) => ({ ref, bytes });

  test("the image the server config names, in its vanilla layout, is the source", () => {
    const hd = upscaled(sources.chest, 2);
    const assets = [
      asset("ui:bad_layout", png(176, 222)),
      asset("ui:hd", hd),
      asset("other:hd", png(256, 256)),
      asset("ui:hopper", sources.hopper),
    ];
    expect(containerTextureSource(assets, "ui:hd")).toBe(hd);
    expect(containerTextureSource(assets, "ui:hopper")).toBe(sources.hopper);
    expect(containerTextureSource(assets, "ui:bad_layout")).toBeUndefined();
    expect(containerTextureSource(assets, "ui:missing")).toBeUndefined();
    expect(containerTextureSource(assets, undefined)).toBeUndefined();
  });

  test("an HD texture is cut at its own scale but drawn at the vanilla size", () => {
    const files = buildVanillaGuiFiles({ ...sources, chest: upscaled(sources.chest, 2) }, none);
    const three = decodePng(files["assets/artisan/textures/gui/generic_9x3.png"]!);
    expect([three.width, three.height]).toEqual([352, 2 * (17 + 3 * 18 + 96)]);
    const { providers } = font(files);
    expect(providers[2]!.height).toBe(17 + 3 * 18 + 96);
    expect(providers.find((p) => p.type === "space")!.advances![cp(0xe013)]).toBe(-(176 + 1) + 8);
  });
});
