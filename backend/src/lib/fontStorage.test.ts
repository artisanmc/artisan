import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  fontDirPaths,
  writeFontAssets,
  deleteFontAssets,
  readFontGlyph,
} from "./fontStorage";

const TEST_PACK = "test-project-fontstorage";

beforeEach(async () => {
  // Wipe any font dirs we might have created.
  await deleteFontAssets(TEST_PACK, "font_a");
  await deleteFontAssets(TEST_PACK, "font_b");
  await deleteFontAssets(TEST_PACK, "font_c");
  await deleteFontAssets(TEST_PACK, "font_d");
  await deleteFontAssets(TEST_PACK, "font_nested");
});
afterEach(async () => {
  await deleteFontAssets(TEST_PACK, "font_a");
  await deleteFontAssets(TEST_PACK, "font_b");
  await deleteFontAssets(TEST_PACK, "font_c");
  await deleteFontAssets(TEST_PACK, "font_d");
  await deleteFontAssets(TEST_PACK, "font_nested");
});

describe("fontStorage", () => {
  test("writeFontAssets creates font.json + glyph PNGs at the right paths", async () => {
    const fontJson = new TextEncoder().encode('{"providers":[]}');
    const pngA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
    const pngB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);
    const glyphs = new Map<string, Uint8Array>([
      ["a.png", pngA],
      ["b.png", pngB],
    ]);

    await writeFontAssets(TEST_PACK, "font_a", fontJson, glyphs);

    const { dir, fontJson: fontJsonPath } = fontDirPaths(TEST_PACK, "font_a");
    expect(existsSync(fontJsonPath)).toBe(true);
    expect(existsSync(join(dir, "a.png"))).toBe(true);
    expect(existsSync(join(dir, "b.png"))).toBe(true);

    const writtenFontJson = await readFile(fontJsonPath);
    expect(writtenFontJson.toString("utf-8")).toBe('{"providers":[]}');
  });

  test("readFontGlyph returns the bytes after a write", async () => {
    const fontJson = new TextEncoder().encode("{}");
    const png = new Uint8Array([10, 20, 30, 40]);
    await writeFontAssets(
      TEST_PACK,
      "font_a",
      fontJson,
      new Map([["x.png", png]]),
    );

    const got = await readFontGlyph(TEST_PACK, "font_a", "x.png");
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([10, 20, 30, 40]);
  });

  test("readFontGlyph returns null for an unknown path", async () => {
    const fontJson = new TextEncoder().encode("{}");
    await writeFontAssets(TEST_PACK, "font_a", fontJson, new Map());

    const got = await readFontGlyph(TEST_PACK, "font_a", "missing.png");
    expect(got).toBeNull();
  });

  test("deleteFontAssets removes the whole dir; idempotent on second call", async () => {
    const fontJson = new TextEncoder().encode("{}");
    const png = new Uint8Array([1, 2, 3]);
    await writeFontAssets(
      TEST_PACK,
      "font_b",
      fontJson,
      new Map([["glyphs/a.png", png]]),
    );
    const { dir } = fontDirPaths(TEST_PACK, "font_b");
    expect(existsSync(dir)).toBe(true);

    await deleteFontAssets(TEST_PACK, "font_b");
    expect(existsSync(dir)).toBe(false);

    // Idempotent: must not throw.
    await deleteFontAssets(TEST_PACK, "font_b");
    expect(existsSync(dir)).toBe(false);
  });

  test("writeFontAssets rejects an absolute glyph path", async () => {
    const fontJson = new TextEncoder().encode("{}");
    const png = new Uint8Array([1]);
    // Use an absolute path appropriate to the platform. On Windows isAbsolute("/foo.png")
    // is also true (treated as absolute from root of current drive), so both POSIX and
    // Windows reject this consistently.
    const badPath = process.platform === "win32" ? "C:\\evil.png" : "/evil.png";
    await expect(
      writeFontAssets(
        TEST_PACK,
        "font_c",
        fontJson,
        new Map([[badPath, png]]),
      ),
    ).rejects.toThrow(/invalid glyph path/);
  });

  test("writeFontAssets rejects a glyph path containing ..", async () => {
    const fontJson = new TextEncoder().encode("{}");
    const png = new Uint8Array([1]);
    await expect(
      writeFontAssets(
        TEST_PACK,
        "font_c",
        fontJson,
        new Map([["../escape.png", png]]),
      ),
    ).rejects.toThrow(/invalid glyph path/);

    await expect(
      writeFontAssets(
        TEST_PACK,
        "font_c",
        fontJson,
        new Map([["glyphs/../../escape.png", png]]),
      ),
    ).rejects.toThrow(/invalid glyph path/);
  });

  test("readFontGlyph returns null for a path containing ..", async () => {
    const fontJson = new TextEncoder().encode("{}");
    await writeFontAssets(TEST_PACK, "font_d", fontJson, new Map());

    const got = await readFontGlyph(TEST_PACK, "font_d", "../../something.png");
    expect(got).toBeNull();

    const got2 = await readFontGlyph(TEST_PACK, "font_d", "glyphs/../../escape.png");
    expect(got2).toBeNull();

    // Absolute path: also silent-null
    const abs = process.platform === "win32" ? "C:\\evil.png" : "/evil.png";
    const got3 = await readFontGlyph(TEST_PACK, "font_d", abs);
    expect(got3).toBeNull();
  });

  test("nested paths work: glyphs/a.png -> <fontDir>/glyphs/a.png", async () => {
    const fontJson = new TextEncoder().encode("{}");
    const png = new Uint8Array([7, 8, 9]);
    await writeFontAssets(
      TEST_PACK,
      "font_nested",
      fontJson,
      new Map([["glyphs/a.png", png]]),
    );

    const { dir } = fontDirPaths(TEST_PACK, "font_nested");
    expect(existsSync(join(dir, "glyphs", "a.png"))).toBe(true);

    const got = await readFontGlyph(TEST_PACK, "font_nested", "glyphs/a.png");
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([7, 8, 9]);
  });
});
