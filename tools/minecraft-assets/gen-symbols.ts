/**
 * The symbols sheet of title texts: the GNU Unifont glyphs of a curated set of Unicode blocks
 * (arrows, maths, box drawing, shapes, dingbats…) that the vanilla bitmap fonts lack. The chat
 * draws them through `unifont.zip` (a `unihex` provider), which the `text_y` / `text_up` fonts
 * cannot reference: they need a bitmap.
 *
 * Output:
 *  - editor/src/lib/pack/symbolGlyphs.ts: `XXXX:<hex>` per glyph, Unifont's own format (16 rows
 *    of 8 or 16 bits). Both pack builders draw the symbols a pack uses from it (the hub's through
 *    `npm run pack -- kotlin-data`).
 *  - editor/src/assets/minecraft/font/symbols.png: every glyph, 16 per row, 16×16 cells, for the
 *    editor preview (`charCells.ts`, atlas `symbols`).
 * Then rerun `gen-char-advances.ts`: it adds their widths and cells.
 *
 * Source: `minecraft/font/unifont.zip` of the game's assets (GNU Unifont, SIL OFL 1.1 or GPL 2+
 * with the font embedding exception; see THIRD_PARTY_NOTICES.md).
 *
 * Usage: cd tools/minecraft-assets && bun gen-symbols.ts [version]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { assetsRoot, ensureAssets } from "./lib/mcAssets";

const VERSION = process.argv[2] ?? "1.21.4";
const OUT_DIR = join(import.meta.dir, "../../editor/src/assets/minecraft/font");
const GLYPHS_OUT = join(import.meta.dir, "../../editor/src/lib/pack/symbolGlyphs.ts");

/** The Unicode blocks of the sheet. */
export const SYMBOL_BLOCKS: readonly [name: string, from: number, to: number][] = [
  ["General Punctuation", 0x2000, 0x206f],
  ["Currency Symbols", 0x20a0, 0x20cf],
  ["Letterlike Symbols", 0x2100, 0x214f],
  ["Number Forms", 0x2150, 0x218f],
  ["Arrows", 0x2190, 0x21ff],
  ["Mathematical Operators", 0x2200, 0x22ff],
  ["Miscellaneous Technical", 0x2300, 0x23ff],
  ["Enclosed Alphanumerics", 0x2460, 0x24ff],
  ["Box Drawing", 0x2500, 0x257f],
  ["Block Elements", 0x2580, 0x259f],
  ["Geometric Shapes", 0x25a0, 0x25ff],
  ["Miscellaneous Symbols", 0x2600, 0x26ff],
  ["Dingbats", 0x2700, 0x27bf],
  ["Miscellaneous Symbols and Arrows", 0x2b00, 0x2bff],
];

/** Invisible format characters (zero width, bidi controls…): Unifont draws them as a dotted box with their code. */
const FORMAT_CHARS = (cp: number) =>
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202f) || (cp >= 0x205f && cp <= 0x206f);

async function unifontHex(): Promise<Map<number, string>> {
  const zipPath = join(assetsRoot(VERSION), "unifont.zip");
  if (!existsSync(zipPath)) {
    const manifest = (await fetch("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").then((r) =>
      r.json(),
    )) as { versions: { id: string; url: string }[] };
    const entry = manifest.versions.find((v) => v.id === VERSION);
    if (!entry) throw new Error(`Minecraft ${VERSION} not in the manifest`);
    const version = (await fetch(entry.url).then((r) => r.json())) as { assetIndex: { url: string } };
    const index = (await fetch(version.assetIndex.url).then((r) => r.json())) as {
      objects: Record<string, { hash: string }>;
    };
    const hash = index.objects["minecraft/font/unifont.zip"]?.hash;
    if (!hash) throw new Error("unifont.zip not in the asset index");
    const bytes = new Uint8Array(
      await fetch(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`).then((r) => r.arrayBuffer()),
    );
    await mkdir(assetsRoot(VERSION), { recursive: true });
    writeFileSync(zipPath, bytes);
  }
  const files = unzipSync(readFileSync(zipPath));
  const name = Object.keys(files).find((f) => f.endsWith(".hex"));
  if (!name) throw new Error("no .hex in unifont.zip");
  const out = new Map<number, string>();
  for (const line of new TextDecoder().decode(files[name]).split("\n")) {
    const [cp, hex] = line.trim().split(":");
    if (cp && hex) out.set(Number.parseInt(cp, 16), hex.toUpperCase());
  }
  return out;
}

await ensureAssets(VERSION);
const hex = await unifontHex();
const defaults = JSON.parse(readFileSync(join(assetsRoot(VERSION), "font/include/default.json"), "utf-8")) as {
  providers: { type: string; chars?: string[] }[];
};
const vanilla = new Set<number>();
for (const p of defaults.providers)
  if (p.type === "bitmap") for (const row of p.chars ?? []) for (const ch of row) vanilla.add(ch.codePointAt(0)!);

const symbols = SYMBOL_BLOCKS.flatMap(([, from, to]) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i),
).filter((cp) => {
  const h = hex.get(cp);
  return h !== undefined && !vanilla.has(cp) && !FORMAT_CHARS(cp) && /[1-9A-F]/.test(h);
});

writeFileSync(
  GLYPHS_OUT,
  [
    "/**",
    ` * GNU Unifont glyphs (Minecraft ${VERSION}'s unifont.zip) of the title texts' symbols sheet:`,
    " * `XXXX:<hex>` per glyph, 16 rows of 8 or 16 bits. SIL OFL 1.1 or GPL 2+ with the font",
    " * embedding exception (THIRD_PARTY_NOTICES.md).",
    " *",
    " * Generated, do not edit: cd tools/minecraft-assets && bun gen-symbols.ts [version]",
    " */",
    "export const SYMBOL_GLYPHS = `",
    ...symbols.map((cp) => `${cp.toString(16).toUpperCase().padStart(4, "0")}:${hex.get(cp)}`),
    "`;",
    "",
  ].join("\n"),
);

const rows = Math.ceil(symbols.length / 16);
const png = new PNG({ width: 256, height: rows * 16 });
symbols.forEach((cp, i) => {
  const h = hex.get(cp)!;
  const wide = h.length === 64;
  for (let y = 0; y < 16; y++) {
    const bits = Number.parseInt(h.slice(y * (wide ? 4 : 2), (y + 1) * (wide ? 4 : 2)), 16);
    const w = wide ? 16 : 8;
    for (let x = 0; x < w; x++) {
      if (!((bits >> (w - 1 - x)) & 1)) continue;
      const o = (((Math.floor(i / 16) * 16 + y) * 256 + (i % 16) * 16 + x) * 4) as number;
      png.data[o] = png.data[o + 1] = png.data[o + 2] = png.data[o + 3] = 255;
    }
  }
});
writeFileSync(join(OUT_DIR, "symbols.png"), PNG.sync.write(png, { colorType: 6 }));
console.log(`[gen-symbols] ${symbols.length} symbols from ${SYMBOL_BLOCKS.length} blocks → ${OUT_DIR}`);
