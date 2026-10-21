import { projectId } from "@/domain/ids";
import { describe, expect, it } from "vitest";
import { menuV1ToDomain } from "./menuV1ToDomain";

/**
 * Asset refs by NAME (ADR `assets-on-server-disk`, decision 2).
 *
 * `asset: icone_diamant` replaces `asset_id: ast_9f3c1a`: on a disk a human
 * must be able to read, an opaque id is a riddle. The plugin reads `asset`
 * first, then `asset_id` (`MenuTitleParser.assetRef`); the editor reads the
 * same two forms, in the same order.
 */
describe("title layers — asset refs by name and opaque id", () => {
  const read = (title: unknown[]) =>
    menuV1ToDomain(
      { schema: "menu/v1", id: "m", title, size: 27, elements: [] },
      { projectId: projectId("p"), lang: "en" },
    ).menu.title;

  it("reads `asset: <name>` as the layer's assetId", () => {
    expect(read([{ kind: "background", asset: "fond_boutique" }])).toEqual([
      { kind: "background", assetId: "fond_boutique" },
    ]);
    expect(read([{ kind: "glyph", asset: "icone_diamant", x: 4, y: 6 }])).toEqual([
      { kind: "glyph", assetId: "icone_diamant", x: 4, y: 6 },
    ]);
  });

  it("still reads the old opaque form", () => {
    expect(read([{ kind: "background", asset_id: "ast_9f3c1a" }])).toEqual([
      { kind: "background", assetId: "ast_9f3c1a" },
    ]);
  });

  it("reads `font: <name>` and the legacy `font_asset_id` on text layers", () => {
    const byName = read([{ kind: "text", value: "Hi", x: 1, y: 2, font: "pixel" }]);
    const byId = read([{ kind: "text", value: "Hi", x: 1, y: 2, font_asset_id: "ast_f0" }]);
    expect((byName[0] as { fontAssetId?: string }).fontAssetId).toBe("pixel");
    expect((byId[0] as { fontAssetId?: string }).fontAssetId).toBe("ast_f0");
  });
});
