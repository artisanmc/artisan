import { describe, expect, test } from "bun:test";
import { computeConflictDiff } from "./conflictDiff";

describe("computeConflictDiff", () => {
  test("identical files → empty diff", () => {
    const same = { "menus/m.yaml": "x" };
    expect(computeConflictDiff(same, same)).toEqual({
      addedOnDisk: [], removedOnDisk: [], modifiedOnDisk: [],
    });
  });

  test("file present on disk but not in backend → addedOnDisk", () => {
    const diff = computeConflictDiff({ "menus/new.yaml": "x" }, {});
    expect(diff.addedOnDisk).toEqual(["menus/new.yaml"]);
    expect(diff.removedOnDisk).toEqual([]);
    expect(diff.modifiedOnDisk).toEqual([]);
  });

  test("file absent from disk but present on backend → removedOnDisk", () => {
    const diff = computeConflictDiff({}, { "menus/old.yaml": "x" });
    expect(diff.removedOnDisk).toEqual(["menus/old.yaml"]);
  });

  test("file present on both sides with different content → modifiedOnDisk", () => {
    const diff = computeConflictDiff({ "menus/m.yaml": "v2" }, { "menus/m.yaml": "v1" });
    expect(diff.modifiedOnDisk).toEqual(["menus/m.yaml"]);
  });

  test("mixed change set", () => {
    const disk = { "a.yaml": "1", "b.yaml": "2", "c.yaml": "new" };
    const backend = { "a.yaml": "1", "b.yaml": "old", "d.yaml": "z" };
    const diff = computeConflictDiff(disk, backend);
    expect(diff.addedOnDisk.sort()).toEqual(["c.yaml"]);
    expect(diff.removedOnDisk.sort()).toEqual(["d.yaml"]);
    expect(diff.modifiedOnDisk.sort()).toEqual(["b.yaml"]);
  });
});
