#!/usr/bin/env bun
/**
 * Régénère `testdata/resource-pack-conformance.json` depuis le constructeur du
 * backend (la source de vérité) : `bun backend/scripts/gen-resource-pack-conformance.ts`.
 *
 * Chaque cas est un ensemble de Projects synthétiques (fichiers texte + binaires
 * en base64), passés par la même orchestration que `rebuildResourcePack`. Le
 * portage navigateur (`editor/src/lib/pack/`) doit rendre le même zip, octet pour
 * octet — vérifié par `resourcePackConformance.test.ts` des deux côtés.
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { PNG } from "pngjs";
import { unzipSync } from "fflate";
import { diskAssetsFromTree } from "../src/lib/diskAssets";
import { imageButtonsFromMenus, type ImageButtonPlacement } from "../src/lib/imageButtons";
import { glyphPlacementsFromMenus, type GlyphPlacement } from "../src/lib/menuGlyphPlacements";
import { buildResourcePackZip, type AssetRow } from "../src/lib/resourcePackBuilder";
import { mergeCodepoints, type GlyphContribution } from "../src/lib/rpCodepointMerger";
import {
  GUI_CONTAINERS,
  containerTextureSource,
  transparentContainersFromMenus,
  type GuiContainer,
} from "../src/lib/vanillaGui";

export interface ConformanceProject {
  id: string;
  files: Record<string, string>;
  binaries: Record<string, string>;
}

export interface ConformanceCase {
  name: string;
  /** Dans l'ordre de l'orchestration : le premier gagne les collisions de codepoints. */
  projects: ConformanceProject[];
  /** `resource-pack.container-textures.*` du `config.yml` du serveur. */
  containerTextures: Partial<Record<GuiContainer, string>>;
  /** Le plugin annonce `vanilla_gui_v1` : les conteneurs transparents sont redessinés. */
  vanillaGui: boolean;
  entries: string[];
  textYFonts: number;
  sha1: string;
}

const VANILLA_FILE: Record<GuiContainer, string> = {
  chest: "generic_54",
  hopper: "hopper",
  dispenser: "dispenser",
};

export function vanillaTexture(container: GuiContainer): Uint8Array {
  return new Uint8Array(
    readFileSync(resolve(import.meta.dir, `../../editor/src/assets/minecraft/${VANILLA_FILE[container]}.png`)),
  );
}

/** Même assemblage que `rebuildResourcePack`, sans base ni serveur. */
export function buildCase(c: Pick<ConformanceCase, "projects" | "containerTextures" | "vanillaGui">) {
  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  const glyphPlacements: GlyphPlacement[] = [];
  const imageButtons: ImageButtonPlacement[] = [];
  const transparent = new Set<GuiContainer>();
  const imagesByRef: { ref: string; bytes: Uint8Array }[] = [];

  for (const p of c.projects) {
    const files = Object.entries(p.files).map(([path, content]) => ({ path, content }));
    const bytesOf = new Map(
      Object.entries(p.binaries).map(([path, b64]) => [path, new Uint8Array(Buffer.from(b64, "base64"))]),
    );
    const binaries = [...bytesOf].map(([path, bytes]) => ({
      path,
      hash: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    }));
    glyphPlacements.push(...glyphPlacementsFromMenus(files));
    imageButtons.push(...imageButtonsFromMenus(files));
    for (const t of transparentContainersFromMenus(files)) transparent.add(t);
    const fromDisk = diskAssetsFromTree(p.id, files, binaries);
    contribs.push({
      projectId: p.id,
      glyphs: fromDisk
        .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
        .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
    });
    for (const a of fromDisk) {
      allAssets.push(a.row);
      if ((a.row.type === "glyph" && a.row.codepoint !== null) || a.row.type === "texture") {
        const bytes = bytesOf.get(a.path);
        if (bytes) {
          glyphPngs.set(a.row.id, bytes);
          imagesByRef.push({ ref: `${p.id}:${a.row.name}`, bytes });
        }
        continue;
      }
      if (a.row.type !== "font") continue;
      const meta = a.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
      const dir = a.path.slice(0, a.path.lastIndexOf("/"));
      const fontMap = new Map<string, Uint8Array>();
      for (const g of meta?.glyphMap ?? []) {
        const bytes = bytesOf.get(`${dir}/${g.texture}`);
        if (bytes) fontMap.set(g.texture, bytes);
      }
      if (fontMap.size > 0) fontGlyphPngs.set(a.row.id, fontMap);
    }
  }

  const { finalCodepoints } = mergeCodepoints(contribs);
  const sources = {} as Record<GuiContainer, Uint8Array>;
  for (const container of GUI_CONTAINERS)
    sources[container] =
      containerTextureSource(imagesByRef, c.containerTextures[container]) ?? vanillaTexture(container);
  return buildResourcePackZip(allAssets, glyphPngs, fontGlyphPngs, { finalCodepoints }, glyphPlacements, imageButtons, {
    sources,
    transparent: c.vanillaGui ? transparent : new Set<GuiContainer>(),
  });
}

/** Entrées du zip, triées. La matrice fixe `text_y{Y}_h{H}.json` (~1 100 fichiers) est seulement comptée. */
export function entriesOf(zip: Uint8Array): { entries: string[]; textYFonts: number } {
  const all = Object.keys(unzipSync(zip)).sort();
  const textY = (e: string) => /^assets\/artisan\/font\/text_y-?\d+_h\d+\.json$/.test(e);
  return { entries: all.filter((e) => !textY(e)), textYFonts: all.filter(textY).length };
}

// --- Entrées synthétiques ------------------------------------------------------

/** PNG RGBA déterministe : `paint(x, y)` rend [r, g, b, a]. */
function png(width: number, height: number, paint: (x: number, y: number) => number[]): string {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) img.data.set(paint(x, y), (y * width + x) * 4);
  return PNG.sync.write(img).toString("base64");
}

// 8×8, colonnes 6-7 transparentes : content_width 6.
const COIN = png(8, 8, (x, y) => (x < 6 ? [255, 200 - y * 10, 0, 255] : [0, 0, 0, 0]));
const GEM = png(7, 9, (x, y) => [x * 30, 0, 255 - y * 20, (x + y) % 3 ? 255 : 128]);
// 16×12 avec un bord transparent : l'ajustement `contain` doit le respecter.
const BUTTON = png(16, 12, (x, y) => (x === 15 || y === 0 ? [0, 0, 0, 0] : [x * 16, y * 20, 128, 255]));
const FONT_A = png(5, 8, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
const FONT_B = png(6, 8, (x, y) => (x < 4 && y > 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
// Texture de conteneur au gabarit vanilla (256×256) : remplace generic_54.
const FANCY_CHEST = png(256, 256, (x, y) => (x < 176 && y < 222 ? [(x * 3) & 255, (y * 5) & 255, 90, 255] : [0, 0, 0, 0]));

const glyph = (name: string, codepoint: number, ascent: number, w: number, h: number, contentWidth?: number) =>
  `codepoint: ${codepoint}\nascent: ${ascent}\nwidth: ${w}\nheight: ${h}\n${contentWidth === undefined ? "" : `content_width: ${contentWidth}\n`}`;

const CASES: Omit<ConformanceCase, "entries" | "textYFonts" | "sha1">[] = [
  {
    name: "glyph, texture and bitmap font, no menu",
    projects: [
      {
        id: "alpha",
        files: {
          "assets/glyphs/coin.yaml": glyph("coin", 0xe000, 7, 8, 8, 6),
          "assets/textures/button.yaml": "width: 16\nheight: 12\n",
          "assets/fonts/pixel/font.yaml":
            'namespace: "artisan:pixel"\nglyphs:\n  - char: a\n    texture: a.png\n    ascent: 7\n    height: 8\n    width: 5\n  - char: b\n    texture: b.png\n    ascent: 7\n    height: 8\n    width: 4\n',
        },
        binaries: {
          "assets/glyphs/coin.png": COIN,
          "assets/textures/button.png": BUTTON,
          "assets/fonts/pixel/a.png": FONT_A,
          "assets/fonts/pixel/b.png": FONT_B,
        },
      },
    ],
    containerTextures: {},
    vanillaGui: false,
  },
  {
    name: "glyph title layers across two projects with a codepoint collision",
    projects: [
      {
        id: "alpha",
        files: {
          "assets/glyphs/coin.yaml": glyph("coin", 0xe000, 7, 8, 8, 6),
          "menus/shop.yaml":
            "id: shop\nsize: 27\ntitle:\n  - kind: glyph\n    asset: coin\n    x: 0\n    y: 30\n  - kind: glyph\n    asset: coin\n    x: 12\n    y: 6\n  - kind: text\n    text: Shop\n    x: 20\n    y: 4\n",
        },
        binaries: { "assets/glyphs/coin.png": COIN },
      },
      {
        id: "beta",
        files: {
          "assets/glyphs/gem.yaml": glyph("gem", 0xe000, 9, 7, 9),
          "menus/vault.yaml":
            "id: vault\nsize: 54\ntitle:\n  kind: glyph\n  asset_id: gem\n  x: 4\n  y: -20\n",
        },
        binaries: { "assets/glyphs/gem.png": GEM },
      },
    ],
    containerTextures: {},
    vanillaGui: false,
  },
  {
    name: "image buttons: fits, offsets, states, hidden inventory, hopper",
    projects: [
      {
        id: "alpha",
        files: {
          "assets/textures/button.yaml": "width: 16\nheight: 12\n",
          "menus/buttons.yaml": [
            "id: buttons",
            "size: 27",
            "player_inventory: hidden",
            "elements:",
            "  - positions: 0-1",
            "    image: { asset: button }",
            "  - positions: '3,4,12,13'",
            "    image: { asset: button, fit: stretch, offset_x: 2, offset_y: -3 }",
            "  - positions: '30'",
            "    image: { asset: button, fit: native }",
            "    states:",
            "      - image: { asset: button, fit: contain, offset_x: -1 }",
            "  - positions: '8'",
            "    image: { asset: missing }",
            "",
          ].join("\n"),
          "menus/funnel.yaml":
            "id: funnel\ninventory_type: hopper\nsize: 5\nelements:\n  - positions: 1-3\n    image: { asset: button }\n",
        },
        binaries: { "assets/textures/button.png": BUTTON },
      },
    ],
    containerTextures: {},
    vanillaGui: false,
  },
  {
    name: "transparent containers redrawn, custom chest texture",
    projects: [
      {
        id: "alpha",
        files: {
          "assets/glyphs/coin.yaml": glyph("coin", 0xe000, 7, 8, 8, 6),
          "assets/textures/fancy_chest.yaml": "width: 256\nheight: 256\n",
          "menus/chest.yaml": "id: chest\nsize: 27\nvanilla_texture: false\n",
          "menus/drop.yaml": "id: drop\ninventory_type: dropper\nsize: 9\nvanilla_texture: false\n",
          "menus/plain.yaml": "id: plain\ninventory_type: hopper\nsize: 5\n",
        },
        binaries: {
          "assets/glyphs/coin.png": COIN,
          "assets/textures/fancy_chest.png": FANCY_CHEST,
        },
      },
    ],
    // Le hopper nomme une image hors gabarit : texture vanilla, comme au backend.
    containerTextures: { chest: "alpha:fancy_chest", hopper: "alpha:coin" },
    vanillaGui: true,
  },
];

if (import.meta.main) {
  const cases = CASES.map((c) => {
    const { zipBytes, hash } = buildCase(c);
    return { ...c, ...entriesOf(zipBytes), sha1: hash };
  });
  const out = resolve(import.meta.dir, "../../testdata/resource-pack-conformance.json");
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        description:
          "Resource pack zip built from synthetic projects (files + base64 binaries) through the rebuildResourcePack orchestration. Generated from the backend builder (backend/scripts/gen-resource-pack-conformance.ts); the browser port must produce the same bytes (sha1 of the zip).",
        cases,
      },
      null,
      2,
    )}\n`,
  );
  for (const c of cases) console.log(`${c.sha1}  ${c.entries.length} entries  ${c.name}`);
}
