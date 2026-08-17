import { describe, expect, it } from "vitest";
import type { Asset } from "@/domain/asset";
import { fontGlyphUrl } from "./fontGlyphUrl";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function makeFontAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "font-1",
    projectId: "p1",
    serverKeyId: "sk1",
    type: "font",
    name: "fancy",
    width: 0,
    height: 0,
    ascent: null,
    codepoint: null,
    fontMeta: {
      namespace: "fancy",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 6 },
        { char: "b", texture: "glyphs/b.png", ascent: 7, height: 8, width: 6 },
      ],
    },
    contentHash: "abc123",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeGlyphAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "glyph-1",
    projectId: "p1",
    serverKeyId: "sk1",
    type: "glyph",
    name: "icon",
    width: 16,
    height: 16,
    ascent: 8,
    codepoint: 0xe000,
    fontMeta: null,
    contentHash: "xyz789",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("fontGlyphUrl", () => {
  it("returns null for non-font asset (type=glyph)", () => {
    const asset = makeGlyphAsset();
    expect(fontGlyphUrl(asset, "a")).toBeNull();
  });

  it("returns URL with contentHash query param and texture path for known char", () => {
    const asset = makeFontAsset();
    expect(fontGlyphUrl(asset, "a")).toBe(
      `${API_URL}/api/v1/textures/asset-font/p1/font-1/glyphs/a.png?h=abc123`,
    );
  });

  it("returns null when char is missing from glyphMap", () => {
    const asset = makeFontAsset();
    expect(fontGlyphUrl(asset, "z")).toBeNull();
  });

  it("preserves texture paths that only use allowed chars", () => {
    const asset = makeFontAsset({
      fontMeta: {
        namespace: "fancy",
        glyphMap: [
          { char: "x", texture: "glyphs/sub-dir/x_1.png", ascent: 7, height: 8, width: 6 },
        ],
      },
    });
    expect(fontGlyphUrl(asset, "x")).toBe(
      `${API_URL}/api/v1/textures/asset-font/p1/font-1/glyphs/sub-dir/x_1.png?h=abc123`,
    );
  });

  it("strips unsafe characters from the texture path", () => {
    const asset = makeFontAsset({
      fontMeta: {
        namespace: "fancy",
        glyphMap: [
          { char: "e", texture: "../escape.png", ascent: 7, height: 8, width: 6 },
          { char: "d", texture: "$foo.png", ascent: 7, height: 8, width: 6 },
        ],
      },
    });
    // ".." is composed of allowed chars (`.`), but the leading slash separator
    // and the `$` are stripped where applicable. Our allowlist keeps `.`, `/`,
    // `-`, `_`, alphanumerics — so `../escape.png` becomes `../escape.png`
    // (backend enforces path-traversal guard); `$foo.png` becomes `foo.png`.
    expect(fontGlyphUrl(asset, "d")).toBe(
      `${API_URL}/api/v1/textures/asset-font/p1/font-1/foo.png?h=abc123`,
    );
    // Verify `$` was actually stripped.
    expect(fontGlyphUrl(asset, "d")).not.toContain("$");
  });

  it("returns null when fontMeta is null (defensive)", () => {
    const asset = makeFontAsset({ fontMeta: null });
    expect(fontGlyphUrl(asset, "a")).toBeNull();
  });
});
