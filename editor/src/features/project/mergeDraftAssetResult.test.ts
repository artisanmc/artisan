import { expect, test } from "vitest";
import { mergeDraftAssetResult } from "./mergeDraftAssetResult";
test("asset acknowledgement preserves later document and binary edits", () => {
  const before = { baseline: {}, tree: { "menus/m.yaml": "old" }, at: 1, binaryTree: {} };
  const saved = {
    ...before,
    tree: { ...before.tree, "assets/icon.yaml": "asset" },
    binaryTree: { "assets/icon.png": { hash: "saved", size: 1 } },
  };
  const local = {
    ...before,
    tree: { "menus/m.yaml": "later" },
    binaryTree: { "textures/later.png": { hash: "later", size: 2 } },
  };
  expect(mergeDraftAssetResult(before, local, saved)).toMatchObject({
    tree: { "menus/m.yaml": "later", "assets/icon.yaml": "asset" },
    binaryTree: {
      "assets/icon.png": { hash: "saved", size: 1 },
      "textures/later.png": { hash: "later", size: 2 },
    },
  });
});
