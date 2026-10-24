import { describe, expect, it } from "vitest";
import { followDisk, rebaseDraft } from "./draftRebase";

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
