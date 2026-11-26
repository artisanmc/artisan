import { describe, expect, it } from "vitest";
import { renderImageButton } from "./imageButtons";
import { createImage } from "./png";
import { drawSliced, sliceOf, slicesAt } from "./slice";

/** An image whose pixel (x, y) holds x in red and y in green. */
function grid(width: number, height: number) {
  const image = createImage(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) image.data.set([x, y, 0, 255], (y * width + x) * 4);
  return image;
}
const row = (image: { width: number; data: Uint8Array | Uint8ClampedArray }, y: number) =>
  Array.from({ length: image.width }, (_, x) => image.data[(y * image.width + x) * 4]);
const column = (
  image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  x: number,
) => Array.from({ length: image.height }, (_, y) => image.data[(y * image.width + x) * 4 + 1]);

describe("sliceOf", () => {
  it("reads the margins, a missing side being 0", () => {
    expect(sliceOf({ slice: { left: 3, top: 2 } })).toEqual({
      left: 3,
      right: 0,
      top: 2,
      bottom: 0,
    });
  });
  it("reads nothing from margins that are not whole numbers ≥ 0, or all 0", () => {
    expect(sliceOf({})).toBeNull();
    expect(sliceOf({ slice: { left: 1.5 } })).toBeNull();
    expect(sliceOf({ slice: { left: -1 } })).toBeNull();
    expect(sliceOf({ slice: { left: "2" } })).toBeNull();
    expect(sliceOf({ slice: { left: 0 } })).toBeNull();
    expect(sliceOf({ slice: [1, 2, 3, 4] })).toBeNull();
  });
});

describe("drawSliced", () => {
  const slice = { left: 2, right: 3, top: 1, bottom: 2 };
  it("copies the corners and repeats what is between the margins", () => {
    const out = drawSliced(grid(8, 6), slice, 13, 9);
    // 2 kept, the 3 middle columns (2, 3, 4) repeated over 8, the last 3 kept.
    expect(row(out, 0)).toEqual([0, 1, 2, 3, 4, 2, 3, 4, 2, 3, 5, 6, 7]);
    // 1 kept, the 3 middle rows (1, 2, 3) repeated over 6, the last 2 kept.
    expect(column(out, 0)).toEqual([0, 1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it("gives the image back at its own size", () => {
    const source = grid(8, 6);
    expect(drawSliced(source, slice, 8, 6).data).toEqual(source.data);
  });
  it("draws smaller than the image while the margins fit", () => {
    expect(row(drawSliced(grid(8, 6), slice, 6, 6), 0)).toEqual([0, 1, 2, 5, 6, 7]);
  });
});

describe("slicesAt", () => {
  const source = { width: 8, height: 6 };
  it("asks for a middle to repeat and room for the margins", () => {
    expect(slicesAt({ left: 2, right: 3, top: 1, bottom: 2 }, source, 5, 3)).toBe(true);
    expect(slicesAt({ left: 2, right: 3, top: 1, bottom: 2 }, source, 4, 3)).toBe(false);
    expect(slicesAt({ left: 4, right: 4, top: 0, bottom: 0 }, source, 54, 18)).toBe(false);
    expect(slicesAt({ left: 0, right: 0, top: 3, bottom: 3 }, source, 54, 18)).toBe(false);
  });
});

describe("renderImageButton with a sliced image", () => {
  const button = { asset: "panel", fit: "contain" as const, width: 54, height: 18, y: 17 };
  it("fills the button's rectangle, whatever its fit", () => {
    const { image, contentWidth } = renderImageButton(grid(8, 6), button, {
      left: 2,
      right: 3,
      top: 1,
      bottom: 2,
    });
    expect(contentWidth).toBe(54);
    expect(row(image, 0).slice(0, 3)).toEqual([0, 1, 2]);
    expect(row(image, 0).slice(-3)).toEqual([5, 6, 7]);
    expect(column(image, 0).slice(-2)).toEqual([4, 5]);
  });
  it("shifts by the offsets", () => {
    const { image } = renderImageButton(
      grid(8, 6),
      { ...button, offset_x: 2 },
      { left: 2, right: 3, top: 1, bottom: 2 },
    );
    expect(image.data[3]).toBe(0);
    expect(row(image, 0).slice(2, 5)).toEqual([0, 1, 2]);
  });
  it("draws by the fit when the margins do not hold", () => {
    const plain = renderImageButton(grid(8, 6), button);
    const refused = renderImageButton(grid(8, 6), button, { left: 4, right: 4, top: 0, bottom: 0 });
    expect(refused.image.data).toEqual(plain.image.data);
  });
});
