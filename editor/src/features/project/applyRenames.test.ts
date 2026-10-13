import { describe, it, expect } from "vitest";
import { planWrite, applyRenames } from "./diskSave";

const BASE = { "menus/ancien.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };

/**
 * Renaming is a move. The tree alone shows a disappearance and an
 * appearance — only the editor knows it is the same Document.
 */
describe("applyRenames", () => {
  it("replaces delete+create with a move", async () => {
    const tree = { "menus/nouveau.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/ancien.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toEqual([
      { from: "menus/ancien.yaml", to: "menus/nouveau.yaml", base_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    // Neither a delete of the old one nor a create of the new one: the file moves.
    expect(plan.deletes).toEqual([]);
    expect(plan.files).toEqual([]);
  });

  it("rename AND modify: the move, then a write based on the old content", async () => {
    const tree = { "menus/nouveau.yaml": "title: A modifié\n", "lang/fr.yaml": "x: y\n" };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/ancien.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toHaveLength(1);
    expect(plan.deletes).toEqual([]);
    expect(plan.files).toHaveLength(1);
    // After the move, the destination holds the old content: that is what the
    // compare-and-swap must expect, not "no file".
    expect(plan.files[0]!.base_hash).toBe(plan.renames[0]!.base_hash);
  });

  it("a rename whose source is unknown to the base falls back to a create", async () => {
    const tree = { "menus/nouveau.yaml": "title: N\n", ...BASE };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/jamais_vu.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toEqual([]);
    expect(plan.files.map((f) => f.path)).toEqual(["menus/nouveau.yaml"]);
    expect(plan.files[0]!.base_hash).toBeNull();
  });

  it("with no declared rename, the plan is unchanged", async () => {
    const tree = { "menus/ancien.yaml": "title: B\n", "lang/fr.yaml": "x: y\n" };
    const before = await planWrite(BASE, tree);
    const after = await applyRenames(before, [], BASE);
    expect(after.files).toEqual(before.files);
    expect(after.deletes).toEqual(before.deletes);
    expect(after.renames).toEqual([]);
  });
});
