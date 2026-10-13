import { describe, it, expect } from "vitest";
import { applyResolutions } from "./resolveConflicts";

/**
 * Resolving a save conflict (ADR `server-disk-only-storage`).
 *
 * Everything goes through a single gesture: **adopt the disk content as the
 * base**.
 * - "keep mine" → the base becomes the disk, so the re-save carries the right
 *   token and legitimately overwrites;
 * - "take the server's" → the base becomes the disk *and* so does the
 *   editor's tree, so there is nothing left to write for that file.
 */
describe("applyResolutions", () => {
  const conflicts = [
    { path: "menus/a.yaml", disk: "title: A serveur\n" },
    { path: "menus/b.yaml", disk: "title: B serveur\n" },
  ];

  it("'keep my version' rebases without touching the editor's tree", () => {
    const out = applyResolutions({}, conflicts, {
      "menus/a.yaml": "mine",
      "menus/b.yaml": "mine",
    });

    expect(out.nextBaseline).toEqual({
      "menus/a.yaml": "title: A serveur\n",
      "menus/b.yaml": "title: B serveur\n",
    });
    // Nothing to bring back: the editor keeps what it has.
    expect(out.adoptFromDisk).toEqual({});
  });

  it("'take the server's' rebases AND returns the content to merge back", () => {
    const out = applyResolutions({}, conflicts, {
      "menus/a.yaml": "disk",
      "menus/b.yaml": "mine",
    });

    expect(out.nextBaseline["menus/a.yaml"]).toBe("title: A serveur\n");
    expect(out.adoptFromDisk).toEqual({ "menus/a.yaml": "title: A serveur\n" });
  });

  it("a file deleted on disk leaves the base instead of staying there as null", () => {
    const out = applyResolutions(
      { "menus/parti.yaml": "title: Ancien\n" },
      [{ path: "menus/parti.yaml", disk: null }],
      { "menus/parti.yaml": "mine" },
    );

    // Absent from the base = "I expect no file here", which yields base_hash null
    // on re-save: exactly the disk's state.
    expect("menus/parti.yaml" in out.nextBaseline).toBe(false);
  });

  it("'take the server's' on a deleted file marks it for removal", () => {
    const out = applyResolutions(
      { "menus/parti.yaml": "title: Ancien\n" },
      [{ path: "menus/parti.yaml", disk: null }],
      { "menus/parti.yaml": "disk" },
    );

    expect("menus/parti.yaml" in out.nextBaseline).toBe(false);
    expect(out.removeFromTree).toEqual(["menus/parti.yaml"]);
  });

  it("preserves the non-conflicting base entries", () => {
    const out = applyResolutions(
      { "lang/fr.yaml": "x: y\n" },
      [{ path: "menus/a.yaml", disk: "title: A\n" }],
      { "menus/a.yaml": "mine" },
    );

    expect(out.nextBaseline["lang/fr.yaml"]).toBe("x: y\n");
  });

  it("a file without an explicit choice is left untouched — never a silent default", () => {
    const out = applyResolutions({}, conflicts, { "menus/a.yaml": "mine" });

    // b was not resolved: its base does not move, so the re-save fails on it
    // rather than deciding for the admin.
    expect("menus/b.yaml" in out.nextBaseline).toBe(false);
    expect(out.unresolved).toEqual(["menus/b.yaml"]);
  });
});
