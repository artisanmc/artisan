import type { Asset } from "@/domain/asset";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { afterEach, expect, it } from "vitest";
import { localAssetPreviewUrl, localFontGlyphUrl } from "./localAssetUrl";

const asset = (over: Partial<Asset>): Asset => ({
  id: "star",
  projectId: "p",
  type: "glyph",
  name: "star",
  width: 8,
  height: 8,
  ascent: 8,
  codepoint: 57344,
  fontMeta: null,
  contentHash: "aa",
  createdAt: "",
  updatedAt: "",
  ...over,
});

afterEach(() => useProjectDraftStore.getState().clear("p"));

it("serves draft-only bytes from the draft blob and unchanged ones from the published file", () => {
  useProjectDraftStore.getState().save("p", {
    baseline: {},
    tree: {},
    at: 1,
    binaryBaseline: {
      "assets/glyphs/star.png": { hash: "aa", size: 1 },
      "assets/fonts/pixel/a.png": { hash: "cc", size: 1 },
    },
    binaryTree: {
      "assets/glyphs/star.png": { hash: "aa", size: 1 },
      "assets/glyphs/new.png": { hash: "bb", size: 1 },
      "assets/fonts/pixel/a.png": { hash: "dd", size: 1 },
    },
    remote: { id: "d1", name: "Work", revision: 2, ownerId: "o" },
  });
  expect(localAssetPreviewUrl(asset({ draftId: "d1" }))).toMatch(
    /\/api\/v1\/projects\/p\/binary\?path=assets%2Fglyphs%2Fstar\.png&h=aa$/,
  );
  expect(localAssetPreviewUrl(asset({ id: "new", contentHash: "bb", draftId: "d1" }))).toMatch(
    /\/api\/v1\/user\/projects\/p\/drafts\/d1\/blobs\/bb$/,
  );
  const font = asset({ id: "pixel", type: "font", contentHash: "ff" });
  expect(localFontGlyphUrl({ ...font, draftId: "d1" }, "a.png")).toMatch(
    /\/drafts\/d1\/blobs\/dd$/,
  );
  expect(localFontGlyphUrl(font, "a.png")).toMatch(
    /binary\?path=assets%2Ffonts%2Fpixel%2Fa\.png&h=cc$/,
  );
});
