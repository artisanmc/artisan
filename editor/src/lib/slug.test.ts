import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify (mirror of backend slug.ts)", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Mon Réseau Survie")).toBe("mon-reseau-survie");
  });

  it("collapses punctuation runs and trims hyphens", () => {
    expect(slugify("  --Hello,, World!--  ")).toBe("hello-world");
  });

  it("falls back when empty", () => {
    expect(slugify("!!!", "network")).toBe("network");
  });

  it("is idempotent on canonical slugs", () => {
    expect(slugify("deja-un-slug")).toBe("deja-un-slug");
  });
});
