// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { zlibSync } from "fflate";
import { describe, expect, test } from "vitest";
import { bitblt, createImage, decodePng, encodePng } from "./png";

const vanilla = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../assets/minecraft/${name}.png`, import.meta.url)));
const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

function chunk(type: string, data: number[]): number[] {
  const body = [...type].map((c) => c.charCodeAt(0)).concat(data);
  const be = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return [...be(data.length), ...body, ...be(crc32(new Uint8Array(body)))];
}

/** Hand-written PNG: `lines` = already-filtered rows (filter byte included). */
function png(
  w: number,
  h: number,
  depth: number,
  colorType: number,
  lines: number[],
  extra: number[] = [],
  interlace = 0,
): Uint8Array {
  const ihdr = [0, 0, 0, w, 0, 0, 0, h, depth, colorType, 0, 0, interlace];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...extra,
    ...chunk("IDAT", [...zlibSync(new Uint8Array(lines))]),
    ...chunk("IEND", []),
  ]);
}

describe("encodePng", () => {
  // pngjs 7 (`PNG.sync.write`) fingerprints on the same pixels: identical output.
  test("writes the same bytes as pngjs", () => {
    const small = createImage(3, 2);
    small.data.forEach((_, i) => {
      small.data[i] = (i * 37) & 0xff;
    });
    expect(hex(encodePng(small))).toBe(
      "89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a00000021494441547801636650f5ca9fb27ce7997b1f99a731ef39fff0cb8a151a2b400000a75c0e2ddb65fb200000000049454e44ae426082",
    );
    expect(sha1(encodePng(decodePng(vanilla("generic_54"))))).toBe(
      "43f922acce2a8719178d69ccb8aee69d6598085b",
    );
    expect(sha1(encodePng(decodePng(vanilla("hopper"))))).toBe(
      "0ef49c70b8f2f740de90a57dc8a207b1df43b5ec",
    );
    expect(sha1(encodePng(decodePng(vanilla("dispenser"))))).toBe(
      "842211fc415ab856bda45ac1f19eee3b37a6c2ce",
    );
  });

  test("round-trips RGBA pixels", () => {
    const image = createImage(17, 9);
    image.data.forEach((_, i) => {
      image.data[i] = (i * 7919) % 251;
    });
    expect(decodePng(encodePng(image))).toEqual(image);
  });
});

describe("decodePng", () => {
  test("palette with tRNS, 2 bits per pixel", () => {
    const plte = chunk("PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const trns = chunk("tRNS", [128]);
    // indices 0 1 2 0 → 0b00_01_10_00
    const image = decodePng(png(4, 1, 2, 3, [0, 0b00011000], [...plte, ...trns]));
    expect([...image.data]).toEqual([
      255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 128,
    ]);
  });

  test("1-bit grayscale is rescaled to 8 bits", () => {
    const image = decodePng(png(3, 1, 1, 0, [0, 0b10100000]));
    expect([...image.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });

  test("16-bit RGB with a transparent color", () => {
    const trns = chunk("tRNS", [0, 1, 0, 2, 0, 3]);
    const image = decodePng(
      png(2, 1, 16, 2, [0, 0, 1, 0, 2, 0, 3, 0x80, 0, 0xff, 0xff, 0, 0], trns),
    );
    expect([...image.data]).toEqual([0, 0, 0, 0, 128, 255, 0, 255]);
  });

  test("undoes every filter type", () => {
    // Gris + alpha 8 bits, 2×5 : une ligne par filtre (aucun, sub, up, average, paeth).
    const lines = [0, 10, 20, 30, 40, 1, 5, 5, 5, 5, 2, 1, 1, 1, 1, 3, 4, 4, 4, 4, 4, 1, 1, 1, 1];
    const image = decodePng(png(2, 5, 8, 4, lines));
    const gray = [...image.data].filter((_, i) => i % 4 === 0);
    const alpha = [...image.data].filter((_, i) => i % 4 === 3);
    expect(gray).toEqual([10, 30, 5, 10, 6, 11, 7, 13, 8, 14]);
    expect(alpha).toEqual([20, 40, 5, 10, 6, 11, 7, 13, 8, 14]);
  });

  test("Adam7 interlaced images land at their pixel", () => {
    // 2×2 gris 8 bits : passes 1 (0,0), 6 (1,0), 7 (0,1)(1,1).
    const image = decodePng(png(2, 2, 8, 0, [0, 1, 0, 2, 0, 3, 4], [], 1));
    expect([...image.data].filter((_, i) => i % 4 === 0)).toEqual([1, 2, 3, 4]);
  });

  test("rejects what pngjs rejects", () => {
    const good = png(1, 1, 8, 0, [0, 7]);
    expect(() => decodePng(good.subarray(1))).toThrow("Invalid file signature");
    const badCrc = good.slice();
    badCrc[29] = (badCrc[29] as number) ^ 1;
    expect(() => decodePng(badCrc)).toThrow();
    expect(() => decodePng(good.subarray(0, good.length - 4))).toThrow();
    expect(() => decodePng(new Uint8Array([...good, 0]))).toThrow();
  });
});

test("bitblt copies a rectangle and checks bounds like pngjs", () => {
  const src = createImage(2, 2);
  src.data.set([1, 2, 3, 4], 12);
  const dst = createImage(3, 3);
  bitblt(src, dst, 1, 1, 1, 1, 2, 0);
  expect([...dst.data.subarray(8, 12)]).toEqual([1, 2, 3, 4]);
  expect(() => bitblt(src, dst, 1, 1, 2, 1, 0, 0)).toThrow("bitblt reading outside image");
  expect(() => bitblt(src, dst, 0, 0, 2, 2, 2, 0)).toThrow("bitblt writing outside image");
});
