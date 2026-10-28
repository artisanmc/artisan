// @vitest-environment node

import { zlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { readPngContentWidth, readPngDimensions } from "./pngDimensions";

// Minimal 1x1 transparent PNG (8 bytes signature + IHDR + IDAT + IEND)
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** Builds a minimal 8-bit RGBA PNG using raw pixel array [R,G,B,A, R,G,B,A, ...]. */
function makePng(width: number, height: number, pixels: number[]): Uint8Array {
  const bpp = 4;
  const rowBytes = width * bpp;
  const raw = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter = None
    for (let x = 0; x < rowBytes; x++) {
      raw[y * (1 + rowBytes) + 1 + x] = pixels[y * rowBytes + x] ?? 0;
    }
  }
  const compressed = zlibSync(raw);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6; // bit depth=8, color type=6 (RGBA)
  const u32be = (n: number) =>
    new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    new Uint8Array([0x49, 0x48, 0x44, 0x52]),
    ihdr,
    new Uint8Array(4),
    u32be(compressed.length),
    new Uint8Array([0x49, 0x44, 0x41, 0x54]),
    compressed,
    new Uint8Array(4),
    u32be(0),
    new Uint8Array([0x49, 0x45, 0x4e, 0x44]),
    new Uint8Array([0xae, 0x42, 0x60, 0x82]),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const px = (a: number) => [255, 0, 0, a]; // red pixel with given alpha
const OPAQUE = () => px(255);
const TRANSPARENT = () => px(0);

describe("readPngDimensions", () => {
  test("reads dimensions from a valid PNG", () => {
    expect(readPngDimensions(PNG_1x1)).toEqual({ width: 1, height: 1 });
  });

  test("throws on non-PNG buffer", () => {
    const notPng = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG signature
    expect(() => readPngDimensions(notPng)).toThrow(/not a png/i);
  });

  test("throws on truncated buffer", () => {
    expect(() => readPngDimensions(new Uint8Array(10))).toThrow(/truncated|not a png/i);
  });
});

describe("readPngContentWidth", () => {
  test("1×1 fully opaque → contentWidth = 1", () => {
    expect(readPngContentWidth(makePng(1, 1, [...OPAQUE()]))).toBe(1);
  });

  test("1×1 fully transparent → contentWidth = 0", () => {
    expect(readPngContentWidth(makePng(1, 1, [...TRANSPARENT()]))).toBe(0);
  });

  test("4×1 first 2 columns opaque, last 2 transparent → contentWidth = 2", () => {
    const png = makePng(4, 1, [...OPAQUE(), ...OPAQUE(), ...TRANSPARENT(), ...TRANSPARENT()]);
    expect(readPngContentWidth(png)).toBe(2);
  });

  test("4×1 fully opaque → contentWidth = 4 (matches header width)", () => {
    const png = makePng(4, 1, [...OPAQUE(), ...OPAQUE(), ...OPAQUE(), ...OPAQUE()]);
    expect(readPngContentWidth(png)).toBe(4);
  });

  test("4×1 all transparent except last column → contentWidth = 4", () => {
    const png = makePng(4, 1, [...TRANSPARENT(), ...TRANSPARENT(), ...TRANSPARENT(), ...OPAQUE()]);
    expect(readPngContentWidth(png)).toBe(4);
  });

  test("2×2 opaque only in row 0 col 0 → contentWidth = 1", () => {
    const png = makePng(2, 2, [
      ...OPAQUE(),
      ...TRANSPARENT(), // row 0
      ...TRANSPARENT(),
      ...TRANSPARENT(), // row 1
    ]);
    expect(readPngContentWidth(png)).toBe(1);
  });

  test("2×2 rightmost opaque pixel in row 1 col 1 → contentWidth = 2", () => {
    const png = makePng(2, 2, [
      ...OPAQUE(),
      ...TRANSPARENT(), // row 0: col 1 transparent
      ...TRANSPARENT(),
      ...OPAQUE(), // row 1: col 1 opaque (rightmost across all rows)
    ]);
    expect(readPngContentWidth(png)).toBe(2);
  });

  test("256×1 opaque only first 176 columns (MC chest width in generic_54.png) → contentWidth = 176", () => {
    const pixels: number[] = [];
    for (let x = 0; x < 256; x++) {
      pixels.push(...(x < 176 ? OPAQUE() : TRANSPARENT()));
    }
    expect(readPngContentWidth(makePng(256, 1, pixels))).toBe(176);
  });

  test("returns header width on non-PNG bytes instead of throwing", () => {
    expect(() => readPngContentWidth(new Uint8Array(50).fill(0x42))).not.toThrow();
  });

  test("PNG_1x1 fixture does not throw", () => {
    expect(() => readPngContentWidth(PNG_1x1)).not.toThrow();
  });
});
