import { describe, it, expect } from "vitest";
import type { AssetId, I18nKey, MenuTitleLayer } from "@/domain/types";
import { toUiLayers, fromUiLayers } from "./uiLayerMapping";

const A = (s: string) => s as AssetId;
const K = (s: string) => s as I18nKey;

describe("toUiLayers", () => {
  it("background → image with stretchToChest=true and x=0,y=0", () => {
    const runtime: MenuTitleLayer[] = [{ kind: "background", assetId: A("a1") }];
    expect(toUiLayers(runtime)).toEqual([
      { kind: "image", assetId: A("a1"), x: 0, y: 0, stretchToChest: true },
    ]);
  });

  it("glyph → image with stretchToChest=false", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "glyph", assetId: A("g1"), x: 10, y: 4 },
    ];
    expect(toUiLayers(runtime)).toEqual([
      { kind: "image", assetId: A("g1"), x: 10, y: 4, stretchToChest: false },
    ]);
  });

  it("text → text (drops color, keeps fontAssetId)", () => {
    const runtime: MenuTitleLayer[] = [
      {
        kind: "text",
        value: { key: K("greeting") },
        x: 8,
        y: 5,
        fontAssetId: A("f1"),
        color: "#ffaa00",
      },
    ];
    const ui = toUiLayers(runtime);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toMatchObject({
      kind: "text",
      x: 8,
      y: 5,
      fontAssetId: A("f1"),
    });
    expect((ui[0] as { kind: "text"; value: { key: I18nKey } }).value.key).toBe(K("greeting"));
    expect(ui[0]).not.toHaveProperty("color");
  });

  it("external_glyph → external passthrough", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 4, y: 4 },
    ];
    const ui = toUiLayers(runtime);
    expect(ui[0]).toEqual({
      kind: "external",
      layer: { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 4, y: 4 },
    });
  });

  it("preserves layer order", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "background", assetId: A("a") },
      { kind: "glyph", assetId: A("g"), x: 1, y: 1 },
      { kind: "text", value: { key: K("t") }, x: 2, y: 2 },
    ];
    expect(toUiLayers(runtime).map((l) => l.kind)).toEqual(["image", "image", "text"]);
  });
});

describe("fromUiLayers", () => {
  it("image stretchToChest=true → background (discards x/y)", () => {
    const ui = [
      { kind: "image" as const, assetId: A("a"), x: 99, y: 99, stretchToChest: true },
    ];
    expect(fromUiLayers(ui)).toEqual([{ kind: "background", assetId: A("a") }]);
  });

  it("image stretchToChest=false → glyph with x/y", () => {
    const ui = [
      { kind: "image" as const, assetId: A("g"), x: 10, y: 4, stretchToChest: false },
    ];
    expect(fromUiLayers(ui)).toEqual([{ kind: "glyph", assetId: A("g"), x: 10, y: 4 }]);
  });

  it("text → text with color=undefined", () => {
    const ui = [
      { kind: "text" as const, value: { key: K("g") }, x: 8, y: 5, fontAssetId: A("f") },
    ];
    expect(fromUiLayers(ui)).toEqual([
      { kind: "text", value: { key: K("g") }, x: 8, y: 5, fontAssetId: A("f"), color: undefined },
    ]);
  });

  it("external → original layer preserved", () => {
    const runtime: MenuTitleLayer = {
      kind: "external_glyph",
      provider: "oraxen",
      glyphName: "coin",
      x: 4,
      y: 4,
    };
    expect(fromUiLayers([{ kind: "external", layer: runtime }])).toEqual([runtime]);
  });
});

describe("round-trip", () => {
  it("all four kinds round-trip", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
      { kind: "text", value: { key: K("t") }, x: 8, y: 5 },
      { kind: "external_glyph", provider: "nexo", glyphName: "x", x: 1, y: 1 },
    ];
    const ui = toUiLayers(runtime);
    const back = fromUiLayers(ui);
    expect(back).toEqual([
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
      { kind: "text", value: { key: K("t") }, x: 8, y: 5, fontAssetId: undefined, color: undefined },
      { kind: "external_glyph", provider: "nexo", glyphName: "x", x: 1, y: 1 },
    ]);
  });

  it("text with legacy color is stripped from the UI layer on read", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("t") }, x: 0, y: 0, color: "#ff0000" },
    ];
    const ui = toUiLayers(runtime);
    expect(ui[0]).not.toHaveProperty("color");
  });
});
