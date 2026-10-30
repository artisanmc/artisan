// @vitest-environment node

import type { DocumentKindContribution } from "@artisan/editor-sdk";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vitest";
import type { AssetIndex } from "./assetIndexBuilder";
import { overlayImageKey, overlayImagesFromFiles } from "./overlayImages";
import { createImage, decodePng, encodePng } from "./png";
import { buildResourcePackZip } from "./resourcePackBuilder";

function opaque(width: number, height: number) {
  const image = createImage(width, height);
  image.data.fill(255);
  return image;
}

function build(pngs: Record<string, ReturnType<typeof createImage>>, asset: string, rise: number) {
  const built = buildResourcePackZip(
    [],
    new Map(Object.entries(pngs).map(([name, image]) => [name, encodePng(image)])),
    new Map(),
    undefined,
    [],
    [],
    undefined,
    undefined,
    [{ asset, rise }],
  );
  const entries = unzipSync(built.zipBytes);
  const index = JSON.parse(strFromU8(entries["assets/artisan/asset-index.json"]!)) as AssetIndex;
  return { entries, index, key: overlayImageKey({ asset, rise }) };
}

const theme = {
  kind: "conversation_theme",
  dir: "themes",
  pack: {
    images: (src: Record<string, unknown>) => {
      if (src.id === "broken") throw new Error("module bug");
      const hud = src.hud as { box?: string; rise?: number } | undefined;
      return hud?.box ? [{ asset: hud.box, rise: hud.rise ?? 0 }] : [];
    },
  },
} as unknown as DocumentKindContribution;

test("a kind's images are read from its folder only, with the file's id", () => {
  const images = overlayImagesFromFiles(
    [
      { path: "themes/tavern.yaml", content: "hud: { box: panel, rise: 92 }" },
      { path: "themes/broken.yaml", content: "hud: { box: panel }" },
      { path: "themes/bad.yaml", content: "hud: [" },
      { path: "themes/high.yaml", content: "hud: { box: panel, rise: 129 }" },
      { path: "themes/low.yaml", content: "hud: { box: panel, rise: -167 }" },
      { path: "menus/tavern.yaml", content: "hud: { box: other }" },
      { path: "themes/sub/deep.yaml", content: "hud: { box: other }" },
    ],
    [theme],
  );
  expect(images).toEqual([{ asset: "panel", rise: 92 }]);
});

test("an image rises with ascent 7 + rise, padded under it when shorter", () => {
  const { entries, index, key } = build({ cursor: opaque(5, 7) }, "cursor", 40);
  const font = JSON.parse(strFromU8(entries[`assets/artisan/font/${key}.json`]!));
  expect(font.providers).toEqual([
    { type: "bitmap", file: `artisan:${key}_0.png`, ascent: 47, height: 47, chars: [""] },
  ]);
  const png = decodePng(entries[`assets/artisan/textures/${key}_0.png`]!);
  expect([png.width, png.height]).toEqual([5, 47]);
  expect(png.data[(6 * 5 + 4) * 4 + 3]).toBe(255);
  expect(png.data[7 * 5 * 4 + 3]).toBe(0);
  expect(index.assets[key]).toMatchObject({ name: "cursor", type: "overlay", slices: [5] });
});

test("a negative rise puts the image below the text line, its own height kept", () => {
  const { entries, key } = build({ bar: opaque(182, 5) }, "bar", -20);
  expect(key.endsWith("_-20")).toBe(true);
  const font = JSON.parse(strFromU8(entries[`assets/artisan/font/${key}.json`]!));
  expect(font.providers[0]).toMatchObject({ ascent: -13, height: 5 });
});

test("an image wider than 256 px is cut into slices of 256 columns", () => {
  const box = opaque(300, 100);
  // The last 4 columns are transparent: the second slice's content is 40 px wide.
  for (let y = 0; y < 100; y++) for (let x = 296; x < 300; x++) box.data[(y * 300 + x) * 4 + 3] = 0;
  const { entries, index, key } = build({ box }, "box", 92);
  const font = JSON.parse(strFromU8(entries[`assets/artisan/font/${key}.json`]!));
  expect(font.providers.map((p: { chars: string[] }) => p.chars[0])).toEqual(["", ""]);
  expect(
    font.providers.every(
      (p: { ascent: number; height: number }) => p.ascent === 99 && p.height === 100,
    ),
  ).toBe(true);
  expect(decodePng(entries[`assets/artisan/textures/${key}_0.png`]!).width).toBe(256);
  expect(decodePng(entries[`assets/artisan/textures/${key}_1.png`]!).width).toBe(44);
  expect(index.assets[key]).toMatchObject({
    width: 300,
    height: 100,
    slices: [256, 40],
    imageHeight: 100,
  });
});

test("an image taller than 256 px, or unknown, adds nothing", () => {
  const { entries, index, key } = build({ tall: opaque(10, 257) }, "tall", 0);
  expect(index.assets[key]).toBeUndefined();
  expect(Object.keys(entries).some((p) => p.includes("overlay/"))).toBe(false);
  expect(
    build({}, "missing", 0).index.assets[overlayImageKey({ asset: "missing", rise: 0 })],
  ).toBeUndefined();
});

test("a kind reads another file of the project, and may place an image by its bottom", () => {
  const mode = {
    kind: "mode",
    dir: "modes",
    pack: {
      images: (src: Record<string, unknown>, context: { file(path: string): unknown }) => {
        const speakers = context.file("data/speakers.yml") as
          | { speakers?: Record<string, { portrait?: string }> }
          | undefined;
        const bottom = src.bottom as number;
        return Object.values(speakers?.speakers ?? {}).flatMap((s) =>
          s.portrait ? [{ asset: s.portrait, bottom }] : [],
        );
      },
    },
  } as unknown as DocumentKindContribution;
  const images = overlayImagesFromFiles(
    [
      { path: "modes/tavern.yaml", content: "bottom: 8" },
      { path: "modes/castle.yaml", content: "bottom: 2.5" },
      {
        path: "data/speakers.yml",
        content: "speakers: { marthe: { portrait: marthe }, garde: {} }",
      },
    ],
    [mode],
  );
  expect(images).toEqual([{ asset: "marthe", bottom: 8 }]);
});

test("an image placed by its bottom rises by its height, once per resolved rise", () => {
  const built = buildResourcePackZip(
    [],
    new Map([["marthe", encodePng(opaque(56, 72))]]),
    new Map(),
    undefined,
    [],
    [],
    undefined,
    undefined,
    [
      { asset: "marthe", bottom: 8 },
      { asset: "marthe", rise: 64 },
      { asset: "marthe", bottom: -100 },
    ],
  );
  const entries = unzipSync(built.zipBytes);
  const index = JSON.parse(strFromU8(entries["assets/artisan/asset-index.json"]!)) as AssetIndex;
  // 72 − 8 = 64, the same font as the explicit rise; 72 + 100 = 172 is out of reach.
  expect(Object.keys(index.assets)).toEqual([overlayImageKey({ asset: "marthe", rise: 64 })]);
  expect(index.assets[overlayImageKey({ asset: "marthe", rise: 64 })]).toMatchObject({
    imageHeight: 72,
  });
});
