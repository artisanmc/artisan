import { describe, expect, it } from "vitest";
import type { Asset } from "./asset";
import { assetMenuReferences, assetUsages } from "./assetUsage";
import type { Project } from "./types";

const asset = { id: "image", projectId: "p", type: "glyph" } as Asset;
const project = {
  id: "p",
  menus: [
    {
      id: "shop",
      title: [{ kind: "background", assetId: "image" }],
      layers: [{ elements: [{ display: {}, states: [{ image: { asset: "image" } }] }] }],
    },
  ],
} as unknown as Project;

describe("asset classification", () => {
  it("infers legacy image uses from menu backgrounds and button states without changing the project", () => {
    const before = JSON.stringify(project);
    expect(assetUsages(asset, project)).toEqual(["button", "menu"]);
    expect(assetMenuReferences(asset, project)).toEqual(["shop"]);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("respects explicit roles, including an intentionally unclassified image", () => {
    expect(assetUsages({ ...asset, usages: [] }, project)).toEqual([]);
    expect(assetUsages({ ...asset, usages: ["menu"] }, project)).toEqual(["menu"]);
    expect(assetUsages(asset)).toEqual([]);
  });
  it("merges both legacy classifications into menu images without duplicates", () => {
    expect(assetUsages({ ...asset, usages: ["background", "button", "decoration"] })).toEqual([
      "menu",
      "button",
    ]);
    const decorated = {
      ...project,
      menus: [{ ...project.menus[0], title: [{ kind: "glyph", assetId: asset.id, x: 30, y: 12 }] }],
    } as Project;
    expect(assetUsages(asset, decorated)).toEqual(["button", "menu"]);
  });
});
