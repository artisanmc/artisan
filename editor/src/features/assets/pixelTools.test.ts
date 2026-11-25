// @vitest-environment node

import { type RgbaImage, createImage } from "@/lib/pack/png";
import { describe, expect, test } from "vitest";
import {
  type Rgba,
  TRANSPARENT,
  colours,
  copyImage,
  fill,
  fromHex,
  mergeColours,
  paint,
  paintLine,
  pixelAt,
  sameImage,
  toHex,
} from "./pixelTools";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const VEIL: Rgba = [200, 100, 0, 128];

/** The image as rows of letters: `r` red, `b` blue, `v` the veil, `.` transparent. */
const rows = (image: RgbaImage) =>
  Array.from({ length: image.height }, (_, y) =>
    Array.from({ length: image.width }, (_, x) => {
      const hex = toHex(pixelAt(image, x, y));
      return { "#ff0000": "r", "#0000ff": "b", "#c8640080": "v" }[hex] ?? ".";
    }).join(""),
  );

const drawn = (width: number, height: number, ...lines: string[]): RgbaImage => {
  const image = createImage(width, height);
  lines.forEach((line, y) =>
    [...line].forEach((letter, x) => {
      const colour = { r: RED, b: BLUE, v: VEIL }[letter];
      if (colour) paint(image, x, y, colour);
    }),
  );
  return image;
};

describe("pixel tools", () => {
  test("a pixel is set once, and nothing outside the image", () => {
    const image = createImage(3, 2);
    expect(paint(image, 1, 1, RED)).toBe(true);
    expect(paint(image, 1, 1, RED)).toBe(false);
    expect(paint(image, 3, 0, RED)).toBe(false);
    expect(paint(image, 0, -1, RED)).toBe(false);
    expect(rows(image)).toEqual(["...", ".r."]);
    // Erasing writes zeros, whatever colour the transparency was asked in.
    expect(paint(image, 1, 1, [9, 9, 9, 0])).toBe(true);
    expect(pixelAt(image, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(paint(image, 1, 1, TRANSPARENT)).toBe(false);
  });

  test("a stroke leaves no gap, and stops at the border", () => {
    const image = createImage(5, 4);
    expect(paintLine(image, { x: 0, y: 0 }, { x: 4, y: 2 }, RED)).toBe(true);
    expect(rows(image)).toEqual(["r....", ".rr..", "...rr", "....."]);
    expect(paintLine(image, { x: 4, y: 3 }, { x: -1, y: 3 }, BLUE)).toBe(true);
    expect(rows(image)[3]).toBe("bbbbb");
    expect(paintLine(image, { x: 0, y: 3 }, { x: 4, y: 3 }, BLUE)).toBe(false);
    expect(paintLine(image, { x: 2, y: 1 }, { x: 2, y: 1 }, BLUE)).toBe(true);
    expect(rows(image)[1]).toBe(".rb..");
  });

  test("the bucket fills the area of one colour, by its four neighbours", () => {
    const image = drawn(5, 4, ".r...", "r.r..", ".r...", ".....");
    // The pixel closed in by the diamond: the fill does not leak through its corners.
    expect(fill(image, 1, 1, BLUE)).toBe(true);
    expect(rows(image)).toEqual([".r...", "rbr..", ".r...", "....."]);
    expect(fill(image, 4, 0, VEIL)).toBe(true);
    expect(rows(image)).toEqual([".rvvv", "rbrvv", "vrvvv", "vvvvv"]);
    // The corner the diamond cuts off stays as it was.
    expect(pixelAt(image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(fill(image, 1, 1, BLUE)).toBe(false);
    expect(fill(image, 9, 9, BLUE)).toBe(false);
    // Emptying an area back to transparent.
    expect(fill(image, 4, 3, TRANSPARENT)).toBe(true);
    expect(rows(image)).toEqual([".r...", "rbr..", ".r...", "....."]);
  });

  test("the palette lists the colours used, the most used first", () => {
    const image = drawn(4, 2, "rrrb", "bv..");
    expect(colours(image, 8)).toEqual([RED, BLUE, VEIL]);
    expect(colours(image, 1)).toEqual([RED]);
    expect(colours(createImage(2, 2), 8)).toEqual([]);
    expect(mergeColours([[RED, BLUE], [BLUE, VEIL], [RED]], 8)).toEqual([RED, BLUE, VEIL]);
    expect(mergeColours([[RED, BLUE], [VEIL]], 2)).toEqual([RED, BLUE]);
  });

  test("a colour is written and read as hex, alpha only when it is not opaque", () => {
    expect(toHex(RED)).toBe("#ff0000");
    expect(toHex(VEIL)).toBe("#c8640080");
    expect(fromHex("#C8640080")).toEqual(VEIL);
    expect(fromHex("0000ff")).toEqual(BLUE);
    expect(fromHex(" #f00 ")).toEqual(RED);
    expect(fromHex("#ff00")).toBeNull();
    expect(fromHex("red")).toBeNull();
  });

  test("a copy is another image with the same pixels", () => {
    const image = drawn(2, 2, "r.", ".b");
    const copy = copyImage(image);
    expect(sameImage(image, copy)).toBe(true);
    paint(copy, 0, 0, BLUE);
    expect(sameImage(image, copy)).toBe(false);
    expect(rows(image)[0]).toBe("r.");
    expect(sameImage(image, createImage(2, 3))).toBe(false);
  });
});
