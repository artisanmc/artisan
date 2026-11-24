// @vitest-environment node

import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { composeImage, composeRecipe, over } from "./compose";
import { type RgbaImage, createImage } from "./png";

const solid = (width: number, height: number, ...rgba: number[]): RgbaImage => {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i++) image.data[i] = rgba[i % 4] as number;
  return image;
};

const pixel = (image: RgbaImage, x: number, y: number) => [
  ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
];

const recipe = (yaml: string) => {
  const read = composeRecipe(parse(yaml));
  if (!read) throw new Error("no recipe");
  return read;
};

// The same cases as the hub's `ComposeTest`: the two builders read and draw a recipe alike.
describe("composed images", () => {
  test("a descriptor without a compose list describes a PNG", () => {
    expect(composeRecipe(parse("width: 16\nheight: 16\n"))).toBeNull();
    expect(composeRecipe(parse("compose: 3\n"))).toBeNull();
    expect(composeRecipe(parse("- a list\n"))).toBeNull();
    expect(recipe("compose: []\n").layers).toEqual([]);
  });

  test("layers are read with their place, and only a grid repeats", () => {
    const read = recipe(`
compose:
  - use: "kit:window.6"
  - image: icon
    x: 19
    y: -4
    columns: 5
  - grid: cell
    x: 7
    columns: 9
    rows: 4
  - grid: cell
    columns: 0
    rows: 65
  - grid: cell
    use: icon
    columns: 4
  - just text
  - image: ""
  - image: icon
    x: 1.5
    y: 900
`);
    expect(read.layers.map((l) => `${l.image} ${l.x} ${l.y} ${l.columns}x${l.rows}`)).toEqual([
      "kit:window.6 0 0 1x1",
      "icon 19 -4 1x1",
      "cell 7 0 9x4",
      "cell 0 0 1x1",
      "icon 0 0 1x1",
      "icon 0 0 1x1",
    ]);
    expect(read.width).toBeNull();
  });

  test("a size is given by both sides or not at all", () => {
    expect(recipe("width: 20\nheight: 10\ncompose: []\n")).toMatchObject({ width: 20, height: 10 });
    expect(recipe("width: 20\ncompose: []\n")).toMatchObject({ width: null, height: null });
    expect(recipe("width: 20\nheight: 513\ncompose: []\n")).toMatchObject({ width: null });
    expect(recipe(`compose:\n${"  - image: a\n".repeat(70)}`).layers).toHaveLength(64);
  });

  test("the image is as large as its first drawn layer reaches, later layers are clipped", () => {
    const images: Record<string, RgbaImage> = {
      red: solid(4, 3, 255, 0, 0, 255),
      blue: solid(2, 2, 0, 0, 255, 255),
    };
    const out = composeImage(
      recipe(
        "compose:\n  - image: gone\n  - grid: red\n    x: 1\n    y: 2\n    columns: 2\n  - image: blue\n    x: 8\n    y: 4\n",
      ),
      (name) => images[name],
    );
    if (!out) throw new Error("no image");
    expect([out.width, out.height]).toEqual([9, 5]);
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 7, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 8, 4)).toEqual([0, 0, 255, 255]);
  });

  test("a given size clips every layer, and nothing drawn is no image", () => {
    const images: Record<string, RgbaImage> = { red: solid(4, 3, 255, 0, 0, 255) };
    const out = composeImage(
      recipe("width: 2\nheight: 2\ncompose:\n  - image: red\n    x: -3\n    y: -2\n"),
      (name) => images[name],
    );
    if (!out) throw new Error("no image");
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(composeImage(recipe("compose:\n  - image: gone\n"), (name) => images[name])).toBeNull();
    expect(composeImage(recipe("compose: []\n"), (name) => images[name])).toBeNull();
  });

  test("a translucent pixel blends over what is under it, in whole numbers", () => {
    const opaque = solid(1, 1, 0, 0, 255, 255);
    over(opaque, solid(1, 1, 200, 100, 0, 128), 0, 0);
    expect(pixel(opaque, 0, 0)).toEqual([100, 50, 127, 255]);
    const veil = solid(1, 1, 0, 255, 0, 128);
    over(veil, solid(1, 1, 255, 0, 0, 128), 0, 0);
    expect(pixel(veil, 0, 0)).toEqual([170, 85, 0, 192]);
    const kept = solid(1, 1, 1, 2, 3, 4);
    over(kept, solid(1, 1, 9, 9, 9, 0), 0, 0);
    expect(pixel(kept, 0, 0)).toEqual([1, 2, 3, 4]);
    const empty = solid(1, 1, 7, 7, 7, 0);
    over(empty, solid(1, 1, 9, 8, 7, 60), 0, 0);
    expect(pixel(empty, 0, 0)).toEqual([9, 8, 7, 60]);
  });
});
