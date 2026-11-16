import { describe, expect, it } from "vitest";
import { diskConflicts, followDisk, pairedBaseline, rebaseDraft } from "./draftRebase";

const current = (files: Record<string, string>) => ({ files, binaries: {} });

describe("rebaseDraft", () => {
  it("adopts a file changed only on the current side", () => {
    const { snapshot, conflicts } = rebaseDraft(
      { baseline: { "a.yaml": "base" }, tree: { "a.yaml": "base" } },
      current({ "a.yaml": "theirs" }),
    );
    expect(snapshot.tree["a.yaml"]).toBe("theirs");
    expect(snapshot.baseline["a.yaml"]).toBe("theirs");
    expect(conflicts).toEqual([]);
  });

  it("keeps a file changed only in my draft", () => {
    const { snapshot, conflicts } = rebaseDraft(
      { baseline: { "a.yaml": "base" }, tree: { "a.yaml": "mine" } },
      current({ "a.yaml": "base" }),
    );
    expect(snapshot.tree["a.yaml"]).toBe("mine");
    expect(snapshot.baseline["a.yaml"]).toBe("base");
    expect(conflicts).toEqual([]);
  });

  it("flags a file changed differently on both sides and keeps mine", () => {
    const { snapshot, conflicts } = rebaseDraft(
      { baseline: { "a.yaml": "base" }, tree: { "a.yaml": "mine" } },
      current({ "a.yaml": "theirs" }),
    );
    expect(snapshot.tree["a.yaml"]).toBe("mine");
    expect(snapshot.baseline["a.yaml"]).toBe("base");
    expect(conflicts).toEqual([{ path: "a.yaml", disk: "theirs" }]);
  });

  it("advances the baseline when both sides made the same change", () => {
    const { snapshot, conflicts } = rebaseDraft(
      { baseline: { "a.yaml": "base" }, tree: { "a.yaml": "same" } },
      current({ "a.yaml": "same" }),
    );
    expect(snapshot.tree["a.yaml"]).toBe("same");
    expect(snapshot.baseline["a.yaml"]).toBe("same");
    expect(conflicts).toEqual([]);
  });

  it("reports a deletion on the current side as a null-disk conflict", () => {
    const { snapshot, conflicts } = rebaseDraft(
      { baseline: { "a.yaml": "base" }, tree: { "a.yaml": "mine" } },
      current({}),
    );
    expect(snapshot.tree["a.yaml"]).toBe("mine");
    expect(conflicts).toEqual([{ path: "a.yaml", disk: null }]);
  });

  it("leaves a renamed path to the draft", () => {
    const { snapshot, conflicts } = rebaseDraft(
      {
        baseline: { "old.yaml": "base" },
        tree: { "old.yaml": "mine" },
        renames: [{ from: "old.yaml", to: "new.yaml" }],
      },
      current({ "old.yaml": "theirs" }),
    );
    expect(snapshot.tree["old.yaml"]).toBe("mine");
    expect(conflicts).toEqual([]);
  });

  it("does not surface changed binaries as text conflicts", () => {
    const { conflicts } = rebaseDraft(
      {
        baseline: { "icon.png": "" },
        tree: { "icon.png": "" },
        binaryBaseline: { "icon.png": { hash: "old", size: 1 } },
        binaryTree: { "icon.png": { hash: "old", size: 1 } },
      },
      { files: { "icon.png": "" }, binaries: { "icon.png": { hash: "new", size: 2 } } },
    );
    expect(conflicts).toEqual([]);
  });
});

describe("followDisk", () => {
  it("renames a draft's files as the disk now spells them, an edit kept", () => {
    const next = followDisk(
      {
        baseline: { "menus/a.yaml": "a", "manifest.yaml": "m", "lang/fr.yaml": "x" },
        initialTree: { "menus/a.yaml": "a", "manifest.yaml": "m", "lang/fr.yaml": "x" },
        tree: { "menus/a.yaml": "mine", "manifest.yaml": "m", "lang/fr.yaml": "x" },
      },
      { "menus/a.yml": "a", "artisan-module.yml": "m", "lang/fr.yaml": "x" },
    );
    expect(next?.tree).toEqual({
      "menus/a.yml": "mine",
      "artisan-module.yml": "m",
      "lang/fr.yaml": "x",
    });
    expect(next?.baseline).toEqual({
      "menus/a.yml": "a",
      "artisan-module.yml": "m",
      "lang/fr.yaml": "x",
    });
  });

  it("folds a draft holding both spellings onto the disk's, keeping the new one", () => {
    // An older resume took `shop.yml` from the disk beside the draft's `shop.yaml`: the
    // same id twice hid the menu.
    const both = { "menus/shop.yaml": "old", "menus/shop.yml": "new" };
    const next = followDisk(
      { baseline: { ...both }, initialTree: { ...both }, tree: { ...both } },
      { "menus/shop.yml": "new" },
    );
    expect(next?.tree).toEqual({ "menus/shop.yml": "new" });
    expect(next?.baseline).toEqual({ "menus/shop.yml": "new" });
    expect(next?.initialTree).toEqual({ "menus/shop.yml": "new" });
  });

  it("keeps the edit made under the old spelling when folding", () => {
    const next = followDisk(
      {
        baseline: { "menus/shop.yaml": "old", "menus/shop.yml": "new" },
        tree: { "menus/shop.yaml": "mine", "menus/shop.yml": "new" },
      },
      { "menus/shop.yml": "new" },
    );
    expect(next?.tree).toEqual({ "menus/shop.yml": "mine" });
    expect(next?.baseline).toEqual({ "menus/shop.yml": "old" });
  });

  it("drops a file the disk removed and the draft left as loaded", () => {
    const next = followDisk(
      {
        baseline: { "commands/boutique.yaml": "raw", "menus/a.yaml": "a" },
        initialTree: { "commands/boutique.yaml": "canonical", "menus/a.yaml": "a" },
        tree: { "commands/boutique.yaml": "canonical", "menus/a.yaml": "mine" },
      },
      { "menus/a.yaml": "a" },
    );
    expect(next?.tree).toEqual({ "menus/a.yaml": "mine" });
    expect(next?.baseline).toEqual({ "menus/a.yaml": "a" });
    expect(next?.initialTree).toEqual({ "menus/a.yaml": "a" });
  });

  it("keeps a move made in an earlier session when the disk respells the moved file", () => {
    // Moved into `catalogue/` while the disk said `.yaml`; the disk then went to `.yml`. The
    // root copy must not come back: the same id twice hides both from the editor.
    const draft = {
      baseline: { "boutique_categories/keys.yaml": "old" },
      initialTree: { "catalogue/boutique_categories/keys.yaml": "old" },
      tree: { "catalogue/boutique_categories/keys.yaml": "old" },
    };
    const next = followDisk(draft, { "boutique_categories/keys.yml": "new" });
    expect(next?.tree ?? draft.tree).toEqual({ "catalogue/boutique_categories/keys.yaml": "old" });
  });

  it("forgets a file the draft deleted once the disk removed it too", () => {
    const next = followDisk(
      {
        baseline: { "a.yaml": "a", "b.yaml": "b" },
        initialTree: { "a.yaml": "a" },
        tree: { "a.yaml": "a" },
      },
      { "a.yaml": "a" },
    );
    expect(next?.baseline).toEqual({ "a.yaml": "a" });
    expect(next?.tree).toEqual({ "a.yaml": "a" });
  });

  it("takes a file the disk added or rewrote", () => {
    const next = followDisk(
      {
        baseline: { "a.yaml": "old" },
        initialTree: { "a.yaml": "old" },
        tree: { "a.yaml": "old" },
      },
      { "a.yaml": "new", "b.yaml": "added" },
    );
    expect(next?.tree).toEqual({ "a.yaml": "new", "b.yaml": "added" });
    expect(next?.baseline).toEqual({ "a.yaml": "new", "b.yaml": "added" });
  });

  it("keeps a file the draft changed, with its base, for publishing to report", () => {
    const draft = {
      baseline: { "a.yaml": "old" },
      initialTree: { "a.yaml": "old" },
      tree: { "a.yaml": "mine" },
    };
    expect(followDisk(draft, {})).toBeNull();
  });

  it("leaves a renamed path to the draft", () => {
    const draft = {
      baseline: { "old.yaml": "x" },
      initialTree: { "old.yaml": "x" },
      tree: { "new.yaml": "x" },
      renames: [{ from: "old.yaml", to: "new.yaml" }],
    };
    expect(followDisk(draft, {})).toBeNull();
  });

  it("returns null when the disk did not move", () => {
    const draft = { baseline: { "a.yaml": "a" }, tree: { "a.yaml": "b" } };
    expect(followDisk(draft, { "a.yaml": "a" })).toBeNull();
  });
});

describe("followDisk, the same YAML value", () => {
  it("takes the disk's file when the draft only reformatted it", () => {
    // A draft saved before `initialTree` existed: its base is the disk's text, its tree the editor's format.
    const draft = {
      baseline: { "guild_levels.yml": "strategy: sequential\n" },
      tree: { "guild_levels.yml": "strategy: 'sequential'\n" },
    };
    const next = followDisk(draft, { "guild_levels.yml": "strategy: ladder\n" });
    expect(next?.tree["guild_levels.yml"]).toBe("strategy: ladder\n");
    expect(next?.baseline["guild_levels.yml"]).toBe("strategy: ladder\n");
  });

  it("moves the base when the draft was edited to what the disk now holds", () => {
    const draft = { baseline: { "a.yml": "x: 1\n" }, tree: { "a.yml": "x: 2\n" } };
    const next = followDisk(draft, { "a.yml": "x:   2\n" });
    expect(next?.baseline["a.yml"]).toBe("x:   2\n");
    expect(next?.tree["a.yml"]).toBe("x: 2\n");
    expect(diskConflicts(next!, { "a.yml": "x:   2\n" })).toEqual([]);
  });
});

describe("diskConflicts", () => {
  it("reports a file the draft and the disk both changed, each its own way", () => {
    const draft = { baseline: { "a.yml": "x: 1\n" }, tree: { "a.yml": "x: 2\n" } };
    expect(diskConflicts(draft, { "a.yml": "x: 3\n" })).toEqual([
      { path: "a.yml", disk: "x: 3\n" },
    ]);
  });

  it("reports a file the disk deleted and the draft edited", () => {
    const draft = { baseline: { "a.yml": "x: 1\n" }, tree: { "a.yml": "x: 2\n" } };
    expect(diskConflicts(draft, {})).toEqual([{ path: "a.yml", disk: null }]);
  });

  it("reports a file both sides created differently", () => {
    const draft = { baseline: {}, tree: { "a.yml": "x: 2\n" } };
    expect(diskConflicts(draft, { "a.yml": "x: 3\n" })).toEqual([
      { path: "a.yml", disk: "x: 3\n" },
    ]);
  });

  it("leaves alone a file only one side changed, a deleted file and a renamed one", () => {
    const draft = {
      baseline: { "mine.yml": "a", "theirs.yml": "a", "gone.yml": "a", "old.yml": "a" },
      tree: { "mine.yml": "b", "theirs.yml": "a", "new.yml": "b" },
      renames: [{ from: "old.yml", to: "new.yml" }],
    };
    const disk = {
      "mine.yml": "a",
      "theirs.yml": "c",
      "gone.yml": "c",
      "old.yml": "c",
      "new.yml": "c",
    };
    expect(diskConflicts(draft, disk)).toEqual([]);
  });

  it("is empty once followDisk merged the files only the disk changed", () => {
    const draft = {
      baseline: { "a.yml": "a", "b.yml": "b" },
      initialTree: { "a.yml": "a", "b.yml": "b" },
      tree: { "a.yml": "a", "b.yml": "mine" },
    };
    const disk = { "a.yml": "server", "b.yml": "b" };
    const next = followDisk(draft, disk)!;
    expect(next.tree["a.yml"]).toBe("server");
    expect(diskConflicts(next, disk)).toEqual([]);
  });
});

describe("pairedBaseline", () => {
  it("keeps the draft's base under a tree older than the refreshed one", () => {
    // The lobby's case: a reload refreshed the base to the server's new file while the tab
    // still held the old tree. Saving it against the new base would have erased the server's.
    const previous = { "guild_levels.yml": "strategy: sequential\n" };
    const store = { "guild_levels.yml": "strategy: ladder\n" };
    const tree = { "guild_levels.yml": "flow: sequential\n" };
    expect(pairedBaseline(previous, store, tree)).toEqual(previous);
  });

  it("moves a file's base when the tree already holds it", () => {
    const previous = { "a.yml": "x: 1\n", "b.yml": "y: 1\n" };
    const store = { "a.yml": "x: 2\n", "b.yml": "y: 2\n" };
    const tree = { "a.yml": "x:  2\n", "b.yml": "y: 9\n" };
    expect(pairedBaseline(previous, store, tree)).toEqual({ "a.yml": "x: 2\n", "b.yml": "y: 1\n" });
  });

  it("takes the store's base without a draft, or when nothing moved", () => {
    const store = { "a.yml": "x: 2\n" };
    expect(pairedBaseline(undefined, store, {})).toBe(store);
    expect(pairedBaseline({ "a.yml": "x: 2\n" }, store, { "a.yml": "x: 5\n" })).toBe(store);
  });

  it("keeps a file the store forgot, and drops one it gained under another tree", () => {
    const previous = { "gone.yml": "a" };
    const store = { "new.yml": "server" };
    const tree = { "gone.yml": "mine", "new.yml": "mine" };
    expect(pairedBaseline(previous, store, tree)).toEqual({ "gone.yml": "a" });
  });
});
