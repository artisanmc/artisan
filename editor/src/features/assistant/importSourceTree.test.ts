import { describe, expect, it } from "vitest";
import {
  buildImportTree,
  filterImportTree,
  selectionState,
  summarizeSelection,
  toggleTreePath,
} from "./importSourceTree";

describe("import source tree", () => {
  it("rebuilds a sorted hierarchy with directories before files", () => {
    expect(
      buildImportTree([
        { path: "root.yml", size: 10 },
        { path: "Categories/tools.yml", size: 30 },
        { path: "Categories/Blocks.yml", size: 20 },
      ]),
    ).toEqual([
      {
        name: "Categories",
        path: "Categories",
        kind: "directory",
        size: 50,
        children: [
          {
            name: "Blocks.yml",
            path: "Categories/Blocks.yml",
            kind: "file",
            size: 20,
            children: [],
          },
          {
            name: "tools.yml",
            path: "Categories/tools.yml",
            kind: "file",
            size: 30,
            children: [],
          },
        ],
      },
      {
        name: "root.yml",
        path: "root.yml",
        kind: "file",
        size: 10,
        children: [],
      },
    ]);
  });

  it("selects every descendant of a folder", () => {
    const tree = buildImportTree([
      { path: "root.yml", size: 10 },
      { path: "categories/blocks.yml", size: 20 },
      { path: "categories/tools.yml", size: 30 },
    ]);
    const categories = tree.find((node) => node.path === "categories");
    if (!categories) throw new Error("categories node missing");

    const selected = toggleTreePath(new Set(), categories, true);

    expect([...selected].sort()).toEqual(["categories/blocks.yml", "categories/tools.yml"]);
    expect(summarizeSelection(selected, tree)).toEqual({ count: 2, bytes: 50 });
  });

  it("reports an intermediate folder when only some descendants are selected", () => {
    const tree = buildImportTree([
      { path: "categories/blocks.yml", size: 20 },
      { path: "categories/tools.yml", size: 30 },
    ]);
    const categories = tree[0];
    if (!categories) throw new Error("categories node missing");

    expect(selectionState(new Set(), categories)).toBe("none");
    expect(selectionState(new Set(["categories/blocks.yml"]), categories)).toBe("some");
    expect(
      selectionState(new Set(["categories/blocks.yml", "categories/tools.yml"]), categories),
    ).toBe("all");
  });

  it("filters by name or path while retaining matching ancestors", () => {
    const tree = buildImportTree([
      { path: "categories/blocks.yml", size: 20 },
      { path: "categories/tools.yml", size: 30 },
      { path: "shop.yml", size: 10 },
    ]);

    expect(filterImportTree(tree, "BLOCK")).toEqual([
      expect.objectContaining({
        path: "categories",
        children: [expect.objectContaining({ path: "categories/blocks.yml" })],
      }),
    ]);
    expect(filterImportTree(tree, "categories/tools")[0]?.children).toEqual([
      expect.objectContaining({ path: "categories/tools.yml" }),
    ]);
  });

  it("counts duplicate metadata paths once in the selection summary", () => {
    const tree = buildImportTree([
      { path: "shop.yml", size: 10 },
      { path: "shop.yml", size: 10 },
    ]);

    expect(summarizeSelection(new Set(["shop.yml"]), tree)).toEqual({ count: 1, bytes: 10 });
  });
});
