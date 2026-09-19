import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildResourcePackZip } from "./resourcePackBuilder";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

function row(over: Partial<{ id: string; type: string; name: string; codepoint: number | null; ascent: number | null; height: number; fontMeta: unknown }>) {
  return {
    id: over.id ?? "asset_g1",
    projectId: "pack_test",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent !== undefined ? over.ascent : 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xE000,
    fontMeta: over.fontMeta !== undefined ? over.fontMeta : null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

function fontRow(over: Partial<{
  id: string;
  name: string;
  glyphMap: Array<{ char: string; texture: string; ascent: number; height: number; width?: number }>;
}>) {
  const name = over.name ?? "myfont";
  return row({
    id: over.id ?? "asset_f1",
    type: "font",
    name,
    codepoint: null,
    ascent: null,
    fontMeta: {
      namespace: `artisan:${name}`,
      glyphMap: over.glyphMap ?? [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      ],
    },
  });
}

describe("buildResourcePackZip", () => {
  test("emits pack.mcmeta with format 64 and supported_formats range", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["pack.mcmeta"]).toBeDefined();
    const meta = JSON.parse(strFromU8(entries["pack.mcmeta"]));
    // Minecraft lit la section `pack` : sous un autre nom de racine, le client
    // refuse le pack entier.
    expect(meta.pack.pack_format).toBe(64);
    expect(meta.pack.supported_formats).toEqual({ min_inclusive: 22, max_inclusive: 200 });
    expect(typeof meta.pack.description).toBe("string");
    // L'icône du pack s'appelle `pack.png` — sous un autre nom, elle n'existe pas.
    expect(entries["pack.png"]).toBeDefined();
  });

  test("includes font/default.json with providers", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs, new Map());
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/default.json"]));
    expect(json.providers[0].id).toBe("minecraft:default");
    expect(json.providers[1].file).toBe("artisan:font/coin.png");
  });

  test("places glyph PNGs under assets/artisan/textures/font/<name>.png", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs, new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/textures/font/coin.png"]).toBeDefined();
    expect(entries["assets/artisan/textures/font/coin.png"].length).toBe(PNG_1x1.length);
  });

  test("returns a stable SHA1 hex hash", () => {
    const { hash } = buildResourcePackZip([], new Map(), new Map());
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const { hash: hash2 } = buildResourcePackZip([], new Map(), new Map());
    expect(hash2).toBe(hash);
  });

  test("ignores assets without codepoints in the bitmap providers", () => {
    const t = row({ id: "asset_t1", type: "texture", name: "bg_one", codepoint: null, ascent: null });
    const pngs = new Map([[t.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([t], pngs, new Map());
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/default.json"]));
    // reference + space (no bitmap for texture without codepoint)
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0].type).toBe("reference");
    expect(json.providers[1].type).toBe("space");
    expect(entries["assets/artisan/textures/font/bg_one.png"]).toBeUndefined();
  });

  test("hash changes when an asset is added", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const a = buildResourcePackZip([], new Map(), new Map()).hash;
    const b = buildResourcePackZip([g], pngs, new Map()).hash;
    expect(a).not.toBe(b);
  });

  test("includes assets/artisan/asset-index.json", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/asset-index.json"]).toBeDefined();
  });

  test("asset-index.json parses to expected { version, assets, offsets } shape", () => {
    const g = row({ id: "asset_g1", codepoint: 0xE000, name: "coin", ascent: 8, height: 9 });
    const t = row({ id: "asset_t1", type: "texture", name: "bg", codepoint: null, ascent: null, height: 32 });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g, t], pngs, new Map());
    const entries = unzipSync(zipBytes);
    const index = JSON.parse(strFromU8(entries["assets/artisan/asset-index.json"]));
    expect(index.version).toBe(2);
    expect(index.assets["asset_g1"]).toEqual({
      name: "coin",
      type: "glyph",
      codepoint: 0xE000,
      ascent: 8,
      height: 9,
      width: 8,
    });
    expect(index.assets["asset_t1"]).toEqual({
      name: "bg",
      type: "texture",
      ascent: null,
      height: 32,
      width: 8,
    });
    expect(index.assets["asset_t1"]).not.toHaveProperty("codepoint");
    // offsets present, keyed by uppercase-hex codepoint
    expect(typeof index.offsets).toBe("object");
    expect(index.offsets["F800"]).toBe(1);
    expect(index.offsets["F809"]).toBe(-1);
    expect(Object.keys(index.offsets)).toHaveLength(18);
  });

  test("emits assets/artisan/font/<name>.json for each font asset", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
        { char: "b", texture: "glyphs/b.png", ascent: 7, height: 8, width: 6 },
      ],
    });
    const fontPngs = new Map([
      [f.id, new Map([
        ["glyphs/a.png", PNG_1x1],
        ["glyphs/b.png", PNG_1x1],
      ])],
    ]);
    const { zipBytes } = buildResourcePackZip([f], new Map(), fontPngs);
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/font/myfont.json"]).toBeDefined();
  });

  test("font.json providers array is shaped correctly with rewritten file paths", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
        { char: "z", texture: "nested/dir/z.png", ascent: 9, height: 10, width: 4 },
      ],
    });
    const fontPngs = new Map([
      [f.id, new Map([
        ["glyphs/a.png", PNG_1x1],
        ["nested/dir/z.png", PNG_1x1],
      ])],
    ]);
    const { zipBytes } = buildResourcePackZip([f], new Map(), fontPngs);
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/myfont.json"]));
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0]).toEqual({
      type: "bitmap",
      file: "artisan:font/myfont/glyphs/a.png",
      ascent: 7,
      height: 8,
      chars: ["a"],
    });
    expect(json.providers[1]).toEqual({
      type: "bitmap",
      file: "artisan:font/myfont/nested/dir/z.png",
      ascent: 9,
      height: 10,
      chars: ["z"],
    });
  });

  test("places font glyph PNGs under assets/artisan/textures/font/<name>/<basename>", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      ],
    });
    const fontPngs = new Map([
      [f.id, new Map([["glyphs/a.png", PNG_1x1]])],
    ]);
    const { zipBytes } = buildResourcePackZip([f], new Map(), fontPngs);
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/textures/font/myfont/glyphs/a.png"]).toBeDefined();
    expect(entries["assets/artisan/textures/font/myfont/glyphs/a.png"].length).toBe(PNG_1x1.length);
  });

  test("missing PNG in fontGlyphPngs map skips the file without crashing", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
        { char: "b", texture: "glyphs/b.png", ascent: 7, height: 8, width: 6 },
      ],
    });
    // Only provide one of the two PNGs
    const fontPngs = new Map([
      [f.id, new Map([["glyphs/a.png", PNG_1x1]])],
    ]);
    const { zipBytes } = buildResourcePackZip([f], new Map(), fontPngs);
    const entries = unzipSync(zipBytes);
    // json still includes both providers (font.json reflects metadata, not file presence)
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/myfont.json"]));
    expect(json.providers).toHaveLength(2);
    // present PNG written, missing one skipped
    expect(entries["assets/artisan/textures/font/myfont/glyphs/a.png"]).toBeDefined();
    expect(entries["assets/artisan/textures/font/myfont/glyphs/b.png"]).toBeUndefined();
  });

  test("missing fontGlyphPngs entry for an asset still emits the JSON", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      ],
    });
    // No entry at all for f.id
    const { zipBytes } = buildResourcePackZip([f], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/font/myfont.json"]).toBeDefined();
    expect(entries["assets/artisan/textures/font/myfont/glyphs/a.png"]).toBeUndefined();
  });

  test("font asset with null fontMeta is skipped", () => {
    const f = row({
      id: "asset_f1",
      type: "font",
      name: "broken",
      codepoint: null,
      ascent: null,
      fontMeta: null,
    });
    const { zipBytes } = buildResourcePackZip([f], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/font/broken.json"]).toBeUndefined();
  });

  test("includes Y-specific text fonts up to Y=172 for h=8 (ascent<=height filter applied)", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    // For h=8, minYForSize=5 (ASCII ascent 7 + shift 1 = 8 = height). Spot-check.
    expect(entries["assets/artisan/font/text_y5_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y6_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y20_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y140_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y172_h8.json"]).toBeDefined();
    // Below the floor and above the cap: not emitted.
    expect(entries["assets/artisan/font/text_y4_h8.json"]).toBeUndefined();
    expect(entries["assets/artisan/font/text_y0_h8.json"]).toBeUndefined();
    expect(entries["assets/artisan/font/text_y-32_h8.json"]).toBeUndefined();
    expect(entries["assets/artisan/font/text_y173_h8.json"]).toBeUndefined();
  });

  test("text_y6_h8.json has space + ascii + accented + nonlatin providers in vanilla order", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/text_y6_h8.json"]));
    expect(json.providers[0].type).toBe("space");
    expect(json.providers[0].advances[" "]).toBe(4);
    // Y=6 is the vanilla title position → bitmap ascents match vanilla unchanged.
    expect(json.providers[1].file).toBe("minecraft:font/ascii.png");
    expect(json.providers[1].ascent).toBe(7);
    expect(json.providers[2].file).toBe("minecraft:font/accented.png");
    expect(json.providers[2].ascent).toBe(10);
    expect(json.providers[3].file).toBe("minecraft:font/nonlatin_european.png");
    expect(json.providers[3].ascent).toBe(7);
  });

  test("text_y0_h16.json shifts every bitmap ascent by +6 (smallest valid h for y=0)", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    // y=0 with h=8 would need ascent=13 > height=8 (invalid, skipped). h=16 is
    // the smallest valid size for y=0: ASCII ascent 13 <= height 16.
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/text_y0_h16.json"]));
    // shift = 6 - 0 = 6. Vanilla ascents +6, independent of h.
    expect(json.providers[1].ascent).toBe(7 + 6);
    expect(json.providers[2].ascent).toBe(10 + 6);
    expect(json.providers[3].ascent).toBe(7 + 6);
  });

  test("hash changes when a font asset is added", () => {
    const f = fontRow({
      name: "myfont",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      ],
    });
    const fontPngs = new Map([
      [f.id, new Map([["glyphs/a.png", PNG_1x1]])],
    ]);
    const a = buildResourcePackZip([], new Map(), new Map()).hash;
    const b = buildResourcePackZip([f], new Map(), fontPngs).hash;
    expect(a).not.toBe(b);
  });

  test("respects mergeResult.finalCodepoints to remap glyph codepoints", () => {
    const g = row({ id: "asset_g1", codepoint: 0xE000, name: "alpha" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip(
      [g],
      pngs,
      new Map(),
      { finalCodepoints: new Map([["asset_g1", 0xE042]]) },
    );
    const entries = unzipSync(zipBytes);

    // The default font.json bitmap provider for "alpha" must reference U+E042.
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/default.json"]));
    const bitmapProvider = json.providers.find(
      (p: { type: string; file?: string }) => p.type === "bitmap" && p.file === "artisan:font/alpha.png",
    );
    expect(bitmapProvider).toBeDefined();
    // The codepoint is encoded as the character in `chars[0]` (U+E042 = code 57410).
    expect(bitmapProvider.chars[0].codePointAt(0)).toBe(0xE042);

    // The asset-index.json also reflects the final codepoint.
    const index = JSON.parse(strFromU8(entries["assets/artisan/asset-index.json"]));
    expect(index.assets["asset_g1"].codepoint).toBe(0xE042);
  });
});

describe("resource project — text_y matrix with size dimension", () => {
  test("emits text_y{Y}_h{H}.json only for Y >= minYForSize(H) (skips invalid ascent>height combos)", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    const textYKeys = Object.keys(entries).filter((k) => k.startsWith("assets/artisan/font/text_y"));
    // Per-h Y count = 172 - minY + 1. Min Ys: h=8→5, h=12→1, h=16→-3,
    // h=20→-7, h=24→-11, h=32→-19. Total = 168+172+176+180+184+192 = 1072.
    expect(textYKeys).toHaveLength(1072);
    // Valid combos present:
    expect(entries["assets/artisan/font/text_y6_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y20_h16.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y172_h32.json"]).toBeDefined();
    // Boundary: y exactly at the min for each h.
    expect(entries["assets/artisan/font/text_y5_h8.json"]).toBeDefined();
    expect(entries["assets/artisan/font/text_y-19_h32.json"]).toBeDefined();
    // Invalid combos (ascent>height): not emitted.
    expect(entries["assets/artisan/font/text_y4_h8.json"]).toBeUndefined();
    expect(entries["assets/artisan/font/text_y-20_h32.json"]).toBeUndefined();
    // h=4 is no longer in the bake set at all.
    expect(entries["assets/artisan/font/text_y10_h4.json"]).toBeUndefined();
    expect(entries["assets/artisan/font/text_y50_h4.json"]).toBeUndefined();
  });

  test("does NOT emit the old text_y{Y}.json filenames", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    // Old format had no _h suffix; assert that shape is fully gone.
    const oldFormat = Object.keys(entries).filter((k) => /assets\/artisan\/font\/text_y-?\d+\.json$/.test(k));
    expect(oldFormat).toHaveLength(0);
  });
});

describe("resource pack — per-layer glyph Y", () => {
  const coin = () => row({ id: "coin", name: "coin", codepoint: 0xE000, ascent: 8, height: 9 });
  const fontAt = (entries: Record<string, Uint8Array>, y: number) => {
    const raw = entries[`assets/artisan/font/glyph_y${y}.json`];
    return raw ? JSON.parse(strFromU8(raw)) : undefined;
  };

  test("emits glyph_y{Y}.json with the glyph's codepoint shifted to ascent 13 - Y", () => {
    const { zipBytes } = buildResourcePackZip([coin()], new Map([["coin", PNG_1x1]]), new Map(), undefined, [
      { assetId: "coin", y: 40 },
    ]);
    const font = fontAt(unzipSync(zipBytes), 40);
    expect(font.providers).toEqual([
      { type: "bitmap", file: "artisan:font/coin.png", ascent: -27, height: 9, chars: [""] },
    ]);
  });

  test("skips the Y the default font already renders", () => {
    const { zipBytes } = buildResourcePackZip([coin()], new Map(), new Map(), undefined, [{ assetId: "coin", y: 5 }]);
    expect(fontAt(unzipSync(zipBytes), 5)).toBeUndefined();
  });

  test("clamps Y above the glyph's floor (ascent <= height)", () => {
    const { zipBytes } = buildResourcePackZip([coin()], new Map(), new Map(), undefined, [{ assetId: "coin", y: -10 }]);
    const entries = unzipSync(zipBytes);
    expect(fontAt(entries, -10)).toBeUndefined();
    expect(fontAt(entries, 4).providers[0].ascent).toBe(9);
  });

  test("groups glyphs sharing a Y, follows remapped codepoints, ignores unknown assets", () => {
    const gem = row({ id: "gem", name: "gem", codepoint: 0xE001, ascent: 8, height: 9 });
    const { zipBytes } = buildResourcePackZip(
      [coin(), gem],
      new Map(),
      new Map(),
      { finalCodepoints: new Map([["gem", 0xE042]]) },
      [{ assetId: "gem", y: 20 }, { assetId: "coin", y: 20 }, { assetId: "coin", y: 20 }, { assetId: "ghost", y: 20 }],
    );
    const font = fontAt(unzipSync(zipBytes), 20);
    expect(font.providers.map((p: { chars: string[] }) => p.chars[0])).toEqual(["", ""]);
  });
});
