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

function row(over: Partial<{ id: string; type: string; name: string; codepoint: number | null; ascent: number | null; height: number }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent !== undefined ? over.ascent : 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xE000,
    fontMeta: null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildResourcePackZip", () => {
  test("emits pack.mcmeta with format 22", () => {
    const { zipBytes } = buildResourcePackZip([], new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["pack.mcmeta"]).toBeDefined();
    const meta = JSON.parse(strFromU8(entries["pack.mcmeta"]));
    expect(meta.pack.pack_format).toBe(22);
    expect(typeof meta.pack.description).toBe("string");
  });

  test("includes font/default.json with providers", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs);
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/default.json"]));
    expect(json.providers[0].id).toBe("minecraft:default");
    expect(json.providers[1].file).toBe("interfaze:font/coin.png");
  });

  test("places glyph PNGs under assets/interfaze/textures/font/<name>.png", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs);
    const entries = unzipSync(zipBytes);
    expect(entries["assets/interfaze/textures/font/coin.png"]).toBeDefined();
    expect(entries["assets/interfaze/textures/font/coin.png"].length).toBe(PNG_1x1.length);
  });

  test("returns a stable SHA1 hex hash", () => {
    const { hash } = buildResourcePackZip([], new Map());
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const { hash: hash2 } = buildResourcePackZip([], new Map());
    expect(hash2).toBe(hash);
  });

  test("ignores assets without codepoints in the bitmap providers", () => {
    const t = row({ id: "asset_t1", type: "texture", name: "bg_one", codepoint: null, ascent: null });
    const pngs = new Map([[t.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([t], pngs);
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/interfaze/font/default.json"]));
    expect(json.providers).toHaveLength(1);
    expect(entries["assets/interfaze/textures/font/bg_one.png"]).toBeUndefined();
  });

  test("hash changes when an asset is added", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const a = buildResourcePackZip([], new Map()).hash;
    const b = buildResourcePackZip([g], pngs).hash;
    expect(a).not.toBe(b);
  });

  test("includes assets/interfaze/asset-index.json", () => {
    const { zipBytes } = buildResourcePackZip([], new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["assets/interfaze/asset-index.json"]).toBeDefined();
  });

  test("asset-index.json parses to expected { version, assets } shape", () => {
    const g = row({ id: "asset_g1", codepoint: 0xE000, name: "coin", ascent: 8, height: 9 });
    const t = row({ id: "asset_t1", type: "texture", name: "bg", codepoint: null, ascent: null, height: 32 });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g, t], pngs);
    const entries = unzipSync(zipBytes);
    const index = JSON.parse(strFromU8(entries["assets/interfaze/asset-index.json"]));
    expect(index.version).toBe(1);
    expect(index.assets["asset_g1"]).toEqual({
      name: "coin",
      type: "glyph",
      codepoint: 0xE000,
      ascent: 8,
      height: 9,
    });
    expect(index.assets["asset_t1"]).toEqual({
      name: "bg",
      type: "texture",
      ascent: null,
      height: 32,
    });
    expect(index.assets["asset_t1"]).not.toHaveProperty("codepoint");
  });
});
