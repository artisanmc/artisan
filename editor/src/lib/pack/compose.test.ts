// @vitest-environment node

import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { composeImage, composeRecipe, composeSize, composeYaml, over, tintColour } from "./compose";
import { paletteOf } from "./palette";
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

  test("a tint multiplies the layer's pixels by its colour, alpha kept, and only a colour tints", () => {
    const grey: Record<string, RgbaImage> = { grey: solid(1, 1, 255, 128, 0, 200) };
    const drawn = composeImage(
      recipe("compose:\n  - image: grey\n    tint: '#c03366'\n"),
      (name) => grey[name],
    );
    expect(drawn && pixel(drawn, 0, 0)).toEqual([192, 26, 0, 200]);
    for (const tint of ["primary", "#fff", "c03366", "#c0336g"]) {
      expect(tintColour(tint)).toBeNull();
      const plain = composeImage(
        recipe(`compose:\n  - image: grey\n    tint: '${tint}'\n`),
        (name) => grey[name],
      );
      expect(plain && pixel(plain, 0, 0)).toEqual([255, 128, 0, 200]);
    }
    // A name is a colour once a palette gives it one.
    const named = recipe("compose:\n  - image: grey\n    tint: primary\n");
    const palette = paletteOf(['primary: "#c03366"\n']);
    const byName = composeImage(named, (name) => grey[name], undefined, palette);
    expect(byName && pixel(byName, 0, 0)).toEqual([192, 26, 0, 200]);
    const unknown = composeImage(
      recipe("compose:\n  - image: grey\n    tint: nowhere\n"),
      (name) => grey[name],
      undefined,
      palette,
    );
    expect(unknown && pixel(unknown, 0, 0)).toEqual([255, 128, 0, 200]);
    // Written back as read.
    const read = recipe("compose:\n  - image: grey\n    tint: '#C03366'\n");
    expect(composeYaml(read)).toEqual([{ image: "grey", tint: "#C03366" }]);
  });

  test("a recipe is written as it is read back, each layer under the key that says what it is", () => {
    const read = recipe(
      "compose:\n  - use: 'kit:window.6'\n  - image: frame\n    x: 4\n    y: -2\n  - grid: 'kit:cell'\n    y: 18\n    columns: 9\n  - grid: tile\n    rows: 3\n",
    );
    const written = composeYaml(read);
    expect(written).toEqual([
      { use: "kit:window.6" },
      { image: "frame", x: 4, y: -2 },
      { grid: "kit:cell", y: 18, columns: 9, rows: 1 },
      { grid: "tile", columns: 1, rows: 3 },
    ]);
    expect(composeRecipe({ compose: written })).toEqual(read);
  });

  test("the size is known from the layers' sizes alone, as the drawn image has it", () => {
    const sizes: Record<string, { width: number; height: number }> = {
      red: { width: 4, height: 3 },
    };
    const sizeOf = (name: string) => sizes[name];
    const grown = recipe(
      "compose:\n  - image: gone\n  - grid: red\n    x: 1\n    y: 2\n    columns: 2\n",
    );
    expect(composeSize(grown, sizeOf)).toEqual({ width: 9, height: 5 });
    const drawn = composeImage(grown, (name) =>
      sizes[name] ? solid(4, 3, 255, 0, 0, 255) : undefined,
    );
    expect([drawn?.width, drawn?.height]).toEqual([9, 5]);
    expect(composeSize(recipe("width: 2\nheight: 7\ncompose:\n  - image: red\n"), sizeOf)).toEqual({
      width: 2,
      height: 7,
    });
    expect(composeSize(recipe("compose:\n  - image: gone\n"), sizeOf)).toBeNull();
  });
});
