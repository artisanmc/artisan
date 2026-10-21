import { describe, expect, it } from "vitest";
import vector from "../../../testdata/document-layout-conformance.json";
import { classifyDocumentLayout, isValidFolderName } from "./documentLayout";

/** Editor half of `testdata/document-layout-conformance.json` — the plugin asserts the same vector. */
describe("classifyDocumentLayout conformance", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      expect(classifyDocumentLayout(c.paths, new Set(c.kindDirs))).toEqual({
        documents: c.documents,
        errors: c.errors,
      });
    });
  }
});

describe("isValidFolderName", () => {
  const kinds = new Set(["menus"]);
  it("accepts a slug", () => expect(isValidFolderName("boutique-2", kinds)).toBe(true));
  it("refuses resource and kind folder names", () => {
    expect(isValidFolderName("lang", kinds)).toBe(false);
    expect(isValidFolderName("menus", kinds)).toBe(false);
  });
  it("refuses capitals, spaces and dots", () => {
    for (const n of ["Boutique", "a b", ".x", ""]) expect(isValidFolderName(n, kinds)).toBe(false);
  });
});
