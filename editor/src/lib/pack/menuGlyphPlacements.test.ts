// @vitest-environment node

import { describe, expect, test } from "vitest";
import { glyphPlacementsFromMenus } from "./menuGlyphPlacements";

describe("glyphPlacementsFromMenus", () => {
  test("collects glyph layers from menu files, both asset ref spellings", () => {
    const files = [
      {
        path: "menus/shop.yaml",
        content:
          "id: shop\ntitle:\n  - kind: glyph\n    asset: coin\n    x: 4\n    y: 30\n  - kind: glyph\n    asset_id: gem\n    x: 0\n    y: -2\n  - kind: text\n    value: hi\n    x: 0\n    y: 3\n",
      },
      { path: "menus/plain.yaml", content: "id: plain\ntitle: Shop\n" },
      {
        path: "commands/buy.yaml",
        content: "title:\n  - kind: glyph\n    asset: nope\n    y: 1\n",
      },
      { path: "menus/broken.yaml", content: "title: [" },
    ];
    expect(glyphPlacementsFromMenus(files)).toEqual([
      { assetId: "coin", y: 30 },
      { assetId: "gem", y: -2 },
    ]);
  });

  test("a single-layer title map and a missing y are tolerated", () => {
    const files = [
      { path: "menus/a.yaml", content: "title:\n  kind: glyph\n  asset: coin\n  y: 12\n" },
      { path: "menus/b.yaml", content: "title:\n  - kind: glyph\n    asset: coin\n" },
    ];
    expect(glyphPlacementsFromMenus(files)).toEqual([{ assetId: "coin", y: 12 }]);
  });
});
