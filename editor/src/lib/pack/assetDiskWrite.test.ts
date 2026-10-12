// @vitest-environment node

import { describe, expect, test } from "vitest";
import { assetDiskPath, descriptorYaml, nextFreeCodepoint } from "./assetDiskWrite";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import type { DiskAsset } from "./diskAssets";

/**
 * Écriture d'un asset sur le disque du serveur (ADR `assets-on-server-disk`, P5).
 *
 * Le backend relaie, il n'écrit plus : le plugin reste le seul écrivain.
 */
describe("assetDiskWrite", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  test("le type donne le dossier, le nom donne le fichier", () => {
    expect(assetDiskPath("glyph", "Icône Diamant")).toBe("assets/glyphs/ic-ne-diamant.png");
    expect(assetDiskPath("texture", "fond_boutique")).toBe("assets/textures/fond_boutique.png");
  });

  test("le descripteur ne porte que ce qu'on sait", () => {
    expect(descriptorYaml({ ascent: 8, codepoint: 57344, width: 16, height: 16 })).toBe(
      "ascent: 8\ncodepoint: 57344\nwidth: 16\nheight: 16\n",
    );
    // Pas de clés nulles : un fichier que l'admin ouvre doit contenir des faits,
    // pas des cases vides.
    expect(descriptorYaml({ ascent: null, codepoint: null })).toBe("{}\n");
  });

  const used = (cp: number): DiskAsset => ({
    path: `assets/glyphs/g${cp}.png`,
    hash: "h",
    row: { codepoint: cp } as DiskAsset["row"],
  });

  test("le codepoint proposé est le premier libre", () => {
    expect(nextFreeCodepoint([])).toBe(0xe000);
    expect(nextFreeCodepoint([used(0xe000), used(0xe001)])).toBe(0xe002);
  });

  /**
   * U+F800..U+F8FF appartient aux providers `space` (cf. `spaceOffsets.ts`), et
   * U+F900+ au bloc CJK Compatibility dont la police par défaut a des glyphes.
   * L'allocateur SQL s'arrêtait à U+F7FF pour cette raison ; son successeur sur
   * disque montait jusqu'à U+F8FF — il aurait fini par attribuer à un glyphe le
   * codepoint d'une espace.
   */
  test("ne sort pas de la plage réservée aux glyphes", () => {
    const all: DiskAsset[] = [];
    for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) all.push(used(cp));
    expect(() => nextFreeCodepoint(all)).toThrow();
    expect(nextFreeCodepoint(all.slice(0, -1))).toBe(CODEPOINT_MAX);
  });
});
