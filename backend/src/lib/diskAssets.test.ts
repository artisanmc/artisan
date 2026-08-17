import { describe, expect, test } from "bun:test";
import { diskAssetsFromTree } from "./diskAssets";

/**
 * Les assets vus depuis le disque du serveur (ADR `assets-on-server-disk`, P4).
 *
 * L'identité est le **nom de fichier**, le type vient du dossier, et le
 * descripteur frère porte ce que le PNG ne sait pas dire.
 */
describe("diskAssetsFromTree", () => {
  const bin = (path: string, hash = "h") => ({ path, hash, size: 10 });

  test("le nom de fichier est l'identité, le dossier donne le type", () => {
    const found = diskAssetsFromTree(
      "p1",
      [],
      [bin("assets/glyphs/diamant.png"), bin("assets/textures/fond.png")],
    );
    expect(found.map((a) => [a.row.id, a.row.type])).toEqual([
      ["diamant", "glyph"],
      ["fond", "texture"],
    ]);
  });

  test("le descripteur frère porte ascent, codepoint et dimensions", () => {
    const found = diskAssetsFromTree(
      "p1",
      [{ path: "assets/glyphs/diamant.yaml", content: "ascent: 8\ncodepoint: 57344\nwidth: 16\nheight: 16\ncontent_width: 12\n" }],
      [bin("assets/glyphs/diamant.png")],
    );
    expect(found[0]!.row).toMatchObject({
      ascent: 8, codepoint: 57344, width: 16, height: 16, contentWidth: 12,
    });
  });

  test("un descripteur cassé ne fait pas disparaître l'image", () => {
    // Punir l'image pour une faute de frappe dans son `.yaml` punirait la
    // mauvaise chose — l'admin verrait un glyphe manquant sans savoir pourquoi.
    const found = diskAssetsFromTree(
      "p1",
      [{ path: "assets/glyphs/diamant.yaml", content: "ascent: : :\n" }],
      [bin("assets/glyphs/diamant.png")],
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.row.ascent).toBeNull();
  });

  test("un binaire hors des dossiers d'assets n'est pas un asset", () => {
    // Une image posée à la racine du Project n'a rien à faire dans le pack :
    // l'appartenance se lit au dossier, pas à l'extension.
    expect(diskAssetsFromTree("p1", [], [bin("capture.png")])).toEqual([]);
  });
});
