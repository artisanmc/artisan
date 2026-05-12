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
    serverKeyId: "sk",
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
      namespace: `interfaze:${name}`,
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
    expect(meta.pack.pack_format).toBe(64);
    expect(meta.pack.supported_formats).toEqual({ min_inclusive: 22, max_inclusive: 200 });
    expect(typeof meta.pack.description).toBe("string");
  });

  test("includes font/default.json with providers", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs, new Map());
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/default.json"]));
    expect(json.providers[0].id).toBe("minecraft:default");
    expect(json.providers[1].file).toBe("interfaze:font/coin.png");
  });

  test("places glyph PNGs under assets/interfaze/textures/font/<name>.png", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs, new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/interfaze/textures/font/coin.png"]).toBeDefined();
    expect(entries["assets/interfaze/textures/font/coin.png"].length).toBe(PNG_1x1.length);
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
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/default.json"]));
    // reference + space (no bitmap for texture without codepoint)
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0].type).toBe("reference");
    expect(json.providers[1].type).toBe("space");
    expect(entries["assets/interfaze/textures/font/bg_one.png"]).toBeUndefined();
  });

  test("hash changes when an asset is added", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const a = buildResourcePackZip([], new Map(), new Map()).hash;
    const b = buildResourcePackZip([g], pngs, new Map()).hash;
    expect(a).not.toBe(b);
  });

  test("includes assets/interfaze/asset-index.json", () => {
    const { zipBytes } = buildResourcePackZip([], new Map(), new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/interfaze/asset-index.json"]).toBeDefined();
  });

  test("asset-index.json parses to expected { version, assets, offsets } shape", () => {
    const g = row({ id: "asset_g1", codepoint: 0xE000, name: "coin", ascent: 8, height: 9 });
    const t = row({ id: "asset_t1", type: "texture", name: "bg", codepoint: null, ascent: null, height: 32 });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g, t], pngs, new Map());
    const entries = unzipSync(zipBytes);
    const index = JSON.parse(strFromU8(entries["assets/interfaze/asset-index.json"]));
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

  test("emits assets/interfaze/font/<name>.json for each font asset", () => {
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
    expect(entries["assets/interfaze/font/myfont.json"]).toBeDefined();
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
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/myfont.json"]));
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0]).toEqual({
      type: "bitmap",
      file: "interfaze:font/myfont/glyphs/a.png",
      ascent: 7,
      height: 8,
      chars: ["a"],
    });
    expect(json.providers[1]).toEqual({
      type: "bitmap",
      file: "interfaze:font/myfont/nested/dir/z.png",
      ascent: 9,
      height: 10,
      chars: ["z"],
    });
  });

  test("places font glyph PNGs under assets/interfaze/textures/font/<name>/<basename>", () => {
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
    expect(entries["assets/interfaze/textures/font/myfont/glyphs/a.png"]).toBeDefined();
    expect(entries["assets/interfaze/textures/font/myfont/glyphs/a.png"].length).toBe(PNG_1x1.length);
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
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/myfont.json"]));
    expect(json.providers).toHaveLength(2);
    // present PNG written, missing one skipped
    expect(entries["assets/interfaze/textures/font/myfont/glyphs/a.png"]).toBeDefined();
    expect(entries["assets/interfaze/textures/font/myfont/glyphs/b.png"]).toBeUndefined();
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
    expect(entries["assets/interfaze/font/myfont.json"]).toBeDefined();
    expect(entries["assets/interfaze/textures/font/myfont/glyphs/a.png"]).toBeUndefined();
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
    expect(entries["assets/interfaze/font/broken.json"]).toBeUndefined();
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
});
