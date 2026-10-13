// @vitest-environment node

import { describe, expect, test } from "vitest";
import { diskAssetsFromTree } from "./diskAssets";

/**
 * Assets as seen from the server's disk (ADR `assets-on-server-disk`).
 *
 * The identity is the **file name**, the type comes from the folder, and the
 * sibling descriptor carries what the PNG cannot say.
 */
describe("diskAssetsFromTree", () => {
  const bin = (path: string, hash = "h") => ({ path, hash, size: 10 });

  test("image usage metadata survives descriptor round trips and preserves unclassified images", () => {
    const files = [
      { path: "assets/glyphs/button.yaml", content: "usages: [button, decoration, button]\n" },
      { path: "assets/textures/background.yaml", content: "usages: [background]\n" },
      { path: "assets/glyphs/unclassified.yaml", content: "usages: []\n" },
      { path: "assets/glyphs/invalid.yaml", content: "usages: [unknown]\n" },
    ];
    const assets = diskAssetsFromTree("p", files, [
      ...files.map((f) => bin(f.path.replace(".yaml", ".png"))),
      bin("assets/glyphs/legacy.png"),
    ]);
    const usages = Object.fromEntries(assets.map((asset) => [asset.row.id, asset.row.usages]));
    expect(usages).toEqual({
      button: ["button", "menu"],
      background: ["menu"],
      unclassified: [],
      invalid: undefined,
      legacy: undefined,
    });
  });

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
      [
        {
          path: "assets/glyphs/diamant.yaml",
          content: "ascent: 8\ncodepoint: 57344\nwidth: 16\nheight: 16\ncontent_width: 12\n",
        },
      ],
      [bin("assets/glyphs/diamant.png")],
    );
    expect(found[0]!.row).toMatchObject({
      ascent: 8,
      codepoint: 57344,
      width: 16,
      height: 16,
      contentWidth: 12,
    });
  });

  test("un descripteur cassé ne fait pas disparaître l'image", () => {
    // Punishing the image for a typo in its `.yaml` would punish the wrong
    // thing — the admin would see a missing glyph without knowing why.
    const found = diskAssetsFromTree(
      "p1",
      [{ path: "assets/glyphs/diamant.yaml", content: "ascent: : :\n" }],
      [bin("assets/glyphs/diamant.png")],
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.row.ascent).toBeNull();
  });

  test("un binaire hors des dossiers d'assets n'est pas un asset", () => {
    // An image at the Project root has no business in the pack: membership is
    // read from the folder, not the extension.
    expect(diskAssetsFromTree("p1", [], [bin("capture.png")])).toEqual([]);
  });
});
