// @vitest-environment node

import { describe, expect, test } from "vitest";
import { diskAssetsFromTree } from "./diskAssets";
import { FONT_DESCRIPTOR, fontFilesFor, fontFromDisk } from "./fontOnDisk";

/**
 * Une police **dépliée** sur le disque du serveur (ADR `assets-on-server-disk`,
 * question ouverte tranchée le 2026-08-17).
 *
 * Mesure qui a décidé : l'ASCII vanilla fait 95 PNG + un descripteur, 26 Ko en
 * tout. Garder le zip aurait mis une boîte noire au milieu d'un dossier dont
 * tout le reste s'édite à la main — pour économiser 96 entrées.
 *
 * Forme retenue :
 *
 *     assets/fonts/<nom>/font.yaml     ← quel caractère, quelle image, ascent
 *     assets/fonts/<nom>/<texture>.png ← un fichier par glyphe
 */
describe("police dépliée", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const parsed = {
    glyphMap: [
      { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      { char: "b", texture: "glyphs/b.png", ascent: 7, height: 8, width: 6 },
    ],
    glyphPngs: new Map([
      ["glyphs/a.png", png],
      ["glyphs/b.png", png],
    ]),
    warnings: [],
  };

  test("un fichier par glyphe, plus le descripteur", () => {
    const { binaries, descriptor } = fontFilesFor("pixelmix", parsed);
    expect(binaries.map((b) => b.path)).toEqual([
      "assets/fonts/pixelmix/glyphs/a.png",
      "assets/fonts/pixelmix/glyphs/b.png",
    ]);
    expect(descriptor.path).toBe(`assets/fonts/pixelmix/${FONT_DESCRIPTOR}`);
    // Le descripteur dit ce que les PNG ne savent pas dire : quel caractère
    // affiche quelle image, à quelle hauteur.
    expect(descriptor.content).toContain("char: a");
    expect(descriptor.content).toContain("texture: glyphs/a.png");
    expect(descriptor.content).toContain("ascent: 7");
  });

  test("relue depuis le disque, elle redonne sa carte de glyphes", () => {
    const { binaries, descriptor } = fontFilesFor("pixelmix", parsed);
    const meta = fontFromDisk(descriptor.content);
    expect(meta?.namespace).toBe("artisan:pixelmix");
    expect(meta?.glyphMap.map((g) => g.char)).toEqual(["a", "b"]);
    expect(binaries).toHaveLength(2);
  });

  test("les PNG d'une police ne sont pas des assets à part entière", () => {
    // Sans ça, la bibliothèque afficherait 95 « glyphes » nommés a, b, c… à côté
    // de la police : c'est elle, l'asset, pas chacune de ses images.
    const found = diskAssetsFromTree(
      "p1",
      [
        {
          path: `assets/fonts/pixelmix/${FONT_DESCRIPTOR}`,
          content: fontFilesFor("pixelmix", parsed).descriptor.content,
        },
      ],
      [
        { path: "assets/fonts/pixelmix/glyphs/a.png", hash: "h1", size: 4 },
        { path: "assets/fonts/pixelmix/glyphs/b.png", hash: "h2", size: 4 },
        { path: "assets/glyphs/diamant.png", hash: "h3", size: 4 },
      ],
    );
    // Triés par chemin : `assets/fonts/…` vient avant `assets/glyphs/…`.
    expect(found.map((a) => [a.row.id, a.row.type])).toEqual([
      ["pixelmix", "font"],
      ["diamant", "glyph"],
    ]);
    const font = found.find((a) => a.row.type === "font")!;
    expect((font.row.fontMeta as { glyphMap: unknown[] }).glyphMap).toHaveLength(2);
  });
});
