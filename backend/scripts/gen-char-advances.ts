/**
 * Generates per-codepoint advance tables for both the plugin (Kotlin) and
 * the editor (TypeScript). The advances are computed by scanning the actual
 * vanilla Minecraft font textures (ascii.png + accented.png + nonlatin_european.png),
 * applying the priority order from `assets/minecraft/font/include/default.json`,
 * and overlaying the `space` provider's hard-coded advances on top.
 *
 * Output:
 *  - plugin/core/src/main/kotlin/net/artisanmc/plugin/render/CharAdvances.kt
 *  - editor/src/features/canvas/title/charAdvances.ts
 *
 * The MC vanilla logic is: try each provider in order; the first to claim a
 * codepoint wins. We replicate this by writing lower-priority entries first
 * (later overwrites earlier in a JS Map). The space provider — first in the
 * top-level default.json — has the highest priority so it overlays last.
 *
 * Codepoints whose advance equals 1 (the MC empty-cell default for a fully
 * transparent bitmap cell) are OMITTED from the output so the table stays
 * compact; the consumer falls back to 1 for missing entries.
 *
 * Usage:
 *   cd backend && bun scripts/gen-char-advances.ts [version]
 *
 * The version arg defaults to 1.21.4. Re-run when bumping MC version.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const VERSION = process.argv[2] ?? "1.21.4";
const FONT_DIR = join(import.meta.dir, "../data/mc-assets", VERSION, "font");
const TEXTURE_DIR = join(import.meta.dir, "../data/mc-assets", VERSION, "textures/font");
const PLUGIN_OUT = join(import.meta.dir, "../../plugin/core/src/main/kotlin/net/artisanmc/plugin/render/CharAdvances.kt");
const EDITOR_OUT = join(import.meta.dir, "../../editor/src/features/canvas/title/charAdvances.ts");

interface BitmapProvider {
  type: "bitmap";
  file: string;
  height?: number;
  ascent: number;
  chars: string[];
}

interface SpaceProvider {
  type: "space";
  advances: Record<string, number>;
}

function scanFont(file: string, rows: string[]): Map<number, number> {
  const buf = readFileSync(join(TEXTURE_DIR, file));
  const png = PNG.sync.read(buf);
  const cellW = png.width / 16;
  const cellH = png.height / rows.length;
  const map = new Map<number, number>();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let col = 0;
    for (const ch of row) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0) { col++; continue; }
      const x0 = col * cellW, y0 = r * cellH;
      let right = -1;
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const i = ((y0 + dy) * png.width + (x0 + dx)) * 4;
          if (png.data[i + 3] > 0) right = Math.max(right, dx);
        }
      }
      map.set(cp, right + 2);
      col++;
    }
  }
  return map;
}

const defaultJson = JSON.parse(readFileSync(join(FONT_DIR, "include/default.json"), "utf-8")) as {
  providers: Array<BitmapProvider | SpaceProvider>;
};
const spaceJson = JSON.parse(readFileSync(join(FONT_DIR, "include/space.json"), "utf-8")) as {
  providers: SpaceProvider[];
};

const bitmapProviders = defaultJson.providers.filter((p): p is BitmapProvider => p.type === "bitmap");

// Vanilla default.json provider order (from disk): nonlatin_european.png,
// accented.png, ascii.png. Build the merged table by writing the LOWEST-priority
// provider first; later writes (higher priority) overwrite.
const merged = new Map<number, number>();
for (let i = bitmapProviders.length - 1; i >= 0; i--) {
  const p = bitmapProviders[i];
  const file = p.file.replace("minecraft:font/", "");
  const m = scanFont(file, p.chars);
  for (const [k, v] of m) merged.set(k, v);
}

// Space provider sits ABOVE the bitmaps in the top-level default.json — its
// entries win regardless of what the bitmaps say.
const spaceAdvances = spaceJson.providers[0].advances;
for (const [ch, adv] of Object.entries(spaceAdvances)) {
  const cp = ch.codePointAt(0)!;
  merged.set(cp, adv);
}

// Drop entries that equal the consumer's default fallback (1) — keeps the
// emitted tables compact without changing observable behavior.
const compact = new Map([...merged].filter(([, v]) => v !== 1));
// Keep BMP only — Kotlin Char is 16-bit. Supplementary plane chars (emoji,
// rare scripts) are uncommon in chest titles and would need surrogate-pair
// handling on the consumer side.
const bmp = new Map([...compact].filter(([cp]) => cp < 0x10000));

const sorted = [...bmp.entries()].sort((a, b) => a[0] - b[0]);

// --- Kotlin output ---
const kt: string[] = [];
kt.push("package net.artisanmc.plugin.render", "");
kt.push("/**");
kt.push(" * Per-codepoint advance (MC pixels) for chars in vanilla MC " + VERSION + " default font.");
kt.push(" *");
kt.push(" * Generated from textures/font/{ascii,accented,nonlatin_european}.png in vanilla");
kt.push(" * priority order, overlaid with include/space.json. Codepoints whose advance is 1");
kt.push(" * (MC empty-cell default) are omitted — lookup falls back to 1 for those.");
kt.push(" *");
kt.push(" * Do not edit by hand. Regenerate via:");
kt.push(" *   cd backend && bun scripts/gen-char-advances.ts [version]");
kt.push(" */");
kt.push("val CHAR_ADVANCES: Map<Int, Int> = mapOf(");
for (const [cp, adv] of sorted) {
  const cpHex = "0x" + cp.toString(16).padStart(4, "0").toUpperCase();
  kt.push(`    ${cpHex} to ${adv},`);
}
kt.push(")", "");
writeFileSync(PLUGIN_OUT, kt.join("\n"));
console.log(`[gen-char-advances] wrote ${PLUGIN_OUT} (${sorted.length} entries)`);

// --- TypeScript output ---
const ts: string[] = [];
ts.push("/**");
ts.push(" * Per-codepoint advance (MC pixels) for chars in vanilla MC " + VERSION + " default font.");
ts.push(" *");
ts.push(" * Generated from textures/font/{ascii,accented,nonlatin_european}.png in vanilla");
ts.push(" * priority order, overlaid with include/space.json. Codepoints whose advance is 1");
ts.push(" * (MC empty-cell default) are omitted — lookup falls back to 1 for those.");
ts.push(" *");
ts.push(" * Do not edit by hand. Regenerate via:");
ts.push(" *   cd backend && bun scripts/gen-char-advances.ts [version]");
ts.push(" */");
ts.push("export const CHAR_ADVANCES: Readonly<Record<number, number>> = {");
for (const [cp, adv] of sorted) {
  const cpHex = "0x" + cp.toString(16).padStart(4, "0").toUpperCase();
  ts.push(`  ${cpHex}: ${adv},`);
}
ts.push("};", "");
ts.push("/** Convenience: look up the advance for a JS string of length 1. Falls back to 1. */");
ts.push("export function charAdvance(ch: string): number {");
ts.push("  const cp = ch.codePointAt(0);");
ts.push("  return cp !== undefined ? (CHAR_ADVANCES[cp] ?? 1) : 1;");
ts.push("}", "");
writeFileSync(EDITOR_OUT, ts.join("\n"));
console.log(`[gen-char-advances] wrote ${EDITOR_OUT} (${sorted.length} entries)`);

// --- Editor cell map: codepoint -> {atlas, col, row} for each char that lives
// in one of the three vanilla atlases. The editor's VanillaMcText uses this
// to render text by cropping the right cell from the right atlas image.
// Resolution: same priority order as the advance table (highest wins) — space
// provider has no glyph so we skip it here.
const CELLS_OUT = join(import.meta.dir, "../../editor/src/features/canvas/title/charCells.ts");
type Cell = { atlas: "ascii" | "accented" | "nonlatin_european"; col: number; row: number };
const cells = new Map<number, Cell>();
// Write in reverse priority order so the higher-priority atlas overwrites.
for (let i = bitmapProviders.length - 1; i >= 0; i--) {
  const p = bitmapProviders[i];
  const atlasName = p.file.replace("minecraft:font/", "").replace(".png", "") as Cell["atlas"];
  for (let r = 0; r < p.chars.length; r++) {
    const row = p.chars[r];
    let col = 0;
    for (const ch of row) {
      const cp = ch.codePointAt(0)!;
      if (cp !== 0) cells.set(cp, { atlas: atlasName, col, row: r });
      col++;
    }
  }
}
const cellsBmp = [...cells].filter(([cp]) => cp < 0x10000).sort((a, b) => a[0] - b[0]);
const atlasShort: Record<Cell["atlas"], string> = {
  ascii: "a",
  accented: "b",
  nonlatin_european: "n",
};
const cellsTs: string[] = [];
cellsTs.push("/**");
cellsTs.push(` * Per-codepoint cell location in the vanilla MC ${VERSION} font atlases.`);
cellsTs.push(" * Codepoint -> { atlas: 'ascii'|'accented'|'nonlatin_european', col, row }");
cellsTs.push(" *");
cellsTs.push(" * Each atlas has its own cell size + ascent (see ATLAS_META below) — the");
cellsTs.push(" * editor uses both to crop the right pixels and align baselines across atlases.");
cellsTs.push(" *");
cellsTs.push(" * Generated alongside CHAR_ADVANCES — do not edit by hand.");
cellsTs.push(" *   cd backend && bun scripts/gen-char-advances.ts [version]");
cellsTs.push(" */");
cellsTs.push("");
cellsTs.push("export type AtlasName = 'ascii' | 'accented' | 'nonlatin_european';");
cellsTs.push("");
cellsTs.push("export interface AtlasMeta {");
cellsTs.push("  /** Cell width in source pixels. All vanilla atlases are 16 cols wide. */");
cellsTs.push("  cellW: number;");
cellsTs.push("  /** Cell height in source pixels. */");
cellsTs.push("  cellH: number;");
cellsTs.push("  /** Vanilla ascent — distance from cell top to baseline. */");
cellsTs.push("  ascent: number;");
cellsTs.push("}");
cellsTs.push("");
cellsTs.push("export const ATLAS_META: Readonly<Record<AtlasName, AtlasMeta>> = {");
for (const name of ["ascii", "accented", "nonlatin_european"] as const) {
  const prov = bitmapProviders.find((p) => p.file === `minecraft:font/${name}.png`)!;
  const buf = readFileSync(join(TEXTURE_DIR, `${name}.png`));
  const png = PNG.sync.read(buf);
  const cellW = png.width / 16;
  const cellH = png.height / prov.chars.length;
  cellsTs.push(`  ${name}: { cellW: ${cellW}, cellH: ${cellH}, ascent: ${prov.ascent} },`);
}
cellsTs.push("};");
cellsTs.push("");
cellsTs.push("/** Compact char→cell map. Atlas names are 1-letter to keep the bundle small. */");
cellsTs.push("type Packed = readonly [atlas: 'a' | 'b' | 'n', col: number, row: number];");
cellsTs.push("const CELLS: Readonly<Record<number, Packed>> = {");
for (const [cp, c] of cellsBmp) {
  const cpHex = "0x" + cp.toString(16).padStart(4, "0").toUpperCase();
  cellsTs.push(`  ${cpHex}: ['${atlasShort[c.atlas]}', ${c.col}, ${c.row}],`);
}
cellsTs.push("};");
cellsTs.push("");
cellsTs.push("const UNPACK: Readonly<Record<'a' | 'b' | 'n', AtlasName>> = {");
cellsTs.push("  a: 'ascii', b: 'accented', n: 'nonlatin_european',");
cellsTs.push("};");
cellsTs.push("");
cellsTs.push("export interface CharCell {");
cellsTs.push("  atlas: AtlasName;");
cellsTs.push("  col: number;");
cellsTs.push("  row: number;");
cellsTs.push("}");
cellsTs.push("");
cellsTs.push("/** Look up the atlas + cell for a single char. Returns null if unsupported. */");
cellsTs.push("export function charCell(ch: string): CharCell | null {");
cellsTs.push("  const cp = ch.codePointAt(0);");
cellsTs.push("  if (cp === undefined) return null;");
cellsTs.push("  const p = CELLS[cp];");
cellsTs.push("  if (!p) return null;");
cellsTs.push("  return { atlas: UNPACK[p[0]], col: p[1], row: p[2] };");
cellsTs.push("}");
cellsTs.push("");
writeFileSync(CELLS_OUT, cellsTs.join("\n"));
console.log(`[gen-char-advances] wrote ${CELLS_OUT} (${cellsBmp.length} entries)`);

// --- Vanilla chars TS (for fontJsonBuilder) ---
function emitProvider(name: string, p: BitmapProvider): string {
  const lines: string[] = [];
  lines.push(`export const ${name}: { height: number; ascent: number; chars: string[] } = {`);
  lines.push(`  height: ${p.height ?? 8},`);
  lines.push(`  ascent: ${p.ascent},`);
  lines.push(`  chars: [`);
  for (const row of p.chars) lines.push(`    ${JSON.stringify(row)},`);
  lines.push(`  ],`);
  lines.push(`};`);
  return lines.join("\n");
}
const VANILLA_OUT = join(import.meta.dir, "../src/lib/vanillaFontChars.ts");
const vanilla: string[] = [];
vanilla.push("/**");
vanilla.push(` * Vanilla MC ${VERSION} bitmap font definitions extracted from`);
vanilla.push(" * assets/minecraft/font/include/default.json. Used by fontJsonBuilder to");
vanilla.push(" * emit text_y{Y}.json with shifted ascent so glyphs land at any chest-y.");
vanilla.push(" *");
vanilla.push(" * Regenerate alongside the char-advance tables via:");
vanilla.push(" *   cd backend && bun scripts/gen-char-advances.ts [version]");
vanilla.push(" */");
vanilla.push("");
const ascii = bitmapProviders.find((p) => p.file === "minecraft:font/ascii.png")!;
const accented = bitmapProviders.find((p) => p.file === "minecraft:font/accented.png")!;
const nonlatin = bitmapProviders.find((p) => p.file === "minecraft:font/nonlatin_european.png")!;
vanilla.push(emitProvider("VANILLA_ASCII", ascii), "");
vanilla.push(emitProvider("VANILLA_ACCENTED", accented), "");
vanilla.push(emitProvider("VANILLA_NONLATIN_EUROPEAN", nonlatin), "");
writeFileSync(VANILLA_OUT, vanilla.join("\n"));
console.log(`[gen-char-advances] wrote ${VANILLA_OUT}`);
