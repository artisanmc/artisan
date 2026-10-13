// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import vectors from "../../../../testdata/resource-pack-conformance.json";
import { sha256Hex } from "../sha256";
import { diskAssetsFromTree } from "./diskAssets";
import { type ImageButtonPlacement, imageButtonsFromMenus } from "./imageButtons";
import { type GlyphPlacement, glyphPlacementsFromMenus } from "./menuGlyphPlacements";
import { type AssetRow, buildResourcePackZip } from "./resourcePackBuilder";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";
import {
  GUI_CONTAINERS,
  type GuiContainer,
  containerTextureSource,
  transparentContainersFromMenus,
} from "./vanillaGui";

interface ConformanceCase {
  name: string;
  projects: { id: string; files: Record<string, string>; binaries: Record<string, string> }[];
  containerTextures: Partial<Record<GuiContainer, string>>;
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
const vanilla = (c: GuiContainer) =>
  new Uint8Array(readFileSync(resolve(__dirname, `../../assets/minecraft/${VANILLA_FILE[c]}.png`)));

/** `buildServerPack`'s assembly, without network. */
function buildCase(c: ConformanceCase) {
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
      Object.entries(p.binaries).map(([path, b64]) => [
        path,
        new Uint8Array(Buffer.from(b64, "base64")),
      ]),
    );
    const binaries = [...bytesOf].map(([path, bytes]) => ({
      path,
      hash: sha256Hex(bytes),
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
      containerTextureSource(imagesByRef, c.containerTextures[container]) ?? vanilla(container);
  return buildResourcePackZip(
    allAssets,
    glyphPngs,
    fontGlyphPngs,
    { finalCodepoints },
    glyphPlacements,
    imageButtons,
    { sources, transparent: c.vanillaGui ? transparent : new Set<GuiContainer>() },
  );
}

const TEXT_Y = /^assets\/artisan\/font\/text_y-?\d+_h\d+\.json$/;

describe("resource pack — cross-stack vector (backend builder is the source)", () => {
  for (const c of vectors.cases as ConformanceCase[]) {
    test(c.name, () => {
      const { zipBytes, hash } = buildCase(c);
      const all = Object.keys(unzipSync(zipBytes)).sort();
      expect(all.filter((e) => !TEXT_Y.test(e))).toEqual(c.entries);
      expect(all.filter((e) => TEXT_Y.test(e))).toHaveLength(c.textYFonts);
      expect(hash).toBe(c.sha1);
    });
  }
});
