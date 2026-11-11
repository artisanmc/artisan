/**
 * Generates the vanilla font textures with taller cells, for the rising text fonts
 * `artisan:text_up{R}` (a HUD drawn in the action bar, above the hotbar).
 *
 * Minecraft refuses a bitmap font whose ascent exceeds its height (`ascent <= height`): a glyph
 * can rise no higher than its own cell. Each cell of ascii.png, accented.png and
 * nonlatin_european.png is therefore copied at the top of a cell PAD rows taller, the rest left
 * transparent: the glyph keeps its size and width, and may rise up to PAD px.
 *
 * Output: editor/src/assets/minecraft/font/{ascii,accented,nonlatin_european}_up.png
 * PAD must match `TEXT_UP_PAD` in editor/src/lib/pack/fontJsonBuilder.ts (a test checks the sizes).
 *
 * Usage:
 *   cd tools/minecraft-assets && bun gen-padded-fonts.ts [version]
 *
 * The version arg defaults to 1.21.4, like gen-char-advances.ts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { assetsRoot, ensureAssets } from "./lib/mcAssets";

const VERSION = process.argv[2] ?? "1.21.4";
const PAD = 128;
const FONTS = ["ascii", "accented", "nonlatin_european"] as const;
const OUT_DIR = join(import.meta.dir, "../../editor/src/assets/minecraft/font");

await ensureAssets(VERSION);
const root = assetsRoot(VERSION);
const defaultJson = JSON.parse(readFileSync(join(root, "font/include/default.json"), "utf-8")) as {
  providers: Array<{ type: string; file?: string; chars?: string[] }>;
};

mkdirSync(OUT_DIR, { recursive: true });
for (const name of FONTS) {
  const provider = defaultJson.providers.find((p) => p.file === `minecraft:font/${name}.png`);
  if (!provider?.chars) throw new Error(`no ${name}.png provider in include/default.json`);
  const rows = provider.chars.length;
  const src = PNG.sync.read(readFileSync(join(root, `textures/font/${name}.png`)));
  const cell = src.height / rows;
  const out = new PNG({ width: src.width, height: rows * (cell + PAD) });
  out.data.fill(0);
  for (let r = 0; r < rows; r++) {
    PNG.bitblt(src, out, 0, r * cell, src.width, cell, 0, r * (cell + PAD));
  }
  const file = join(OUT_DIR, `${name}_up.png`);
  writeFileSync(file, PNG.sync.write(out, { colorType: 6 }));
  console.log(`${name}_up.png  ${src.width}×${out.height}  (cell ${cell} + ${PAD})`);
}
