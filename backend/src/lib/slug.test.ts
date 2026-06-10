import { describe, expect, it } from "bun:test";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
	it("lowercases and hyphenates", () => {
		expect(slugify("Survie PvP")).toBe("survie-pvp");
	});
	it("strips diacritics and punctuation, collapses/trims hyphens", () => {
		expect(slugify("  Héllo Wörld!! ")).toBe("hello-world");
		expect(slugify("A — B / C")).toBe("a-b-c");
	});
	it("falls back when the name has no slug-able characters", () => {
		expect(slugify("***")).toBe("item");
		expect(slugify("", "network")).toBe("network");
	});
});

describe("uniqueSlug", () => {
	it("returns the base when free", () => {
		expect(uniqueSlug("survie", [])).toBe("survie");
		expect(uniqueSlug("survie", ["autre"])).toBe("survie");
	});
	it("appends -2, -3, … on collision", () => {
		expect(uniqueSlug("survie", ["survie"])).toBe("survie-2");
		expect(uniqueSlug("survie", ["survie", "survie-2"])).toBe("survie-3");
	});
});
