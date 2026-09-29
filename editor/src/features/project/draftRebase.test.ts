import { describe, expect, it } from "vitest";
import { rebaseDraft } from "./draftRebase";

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
