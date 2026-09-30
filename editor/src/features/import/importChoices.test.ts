import { describe, expect, it } from "vitest";
import { allConflictsResolved, withChoice, withChoiceForRemaining } from "./importChoices";
import type { ImportConflict } from "./importMerge";

const conflicts: ImportConflict[] = [
  { path: "menus/a.yaml", kind: "text", server: "a", serverBinary: null },
  { path: "menus/b.yaml", kind: "text", server: "b", serverBinary: null },
  { path: "menus/c.yaml", kind: "text", server: "c", serverBinary: null },
];

describe("importChoices", () => {
  it("fixe le choix d'un seul fichier", () => {
    expect(withChoice({}, "menus/b.yaml", "server")).toEqual({ "menus/b.yaml": "server" });
  });

  it("étend un choix au fichier courant et à tous les suivants", () => {
    expect(withChoiceForRemaining({}, conflicts, 1, "import")).toEqual({
      "menus/b.yaml": "import",
      "menus/c.yaml": "import",
    });
  });

  it("un conflit sans choix bloque l'application", () => {
    expect(allConflictsResolved({ "menus/a.yaml": "server" }, conflicts)).toBe(false);
    expect(
      allConflictsResolved(
        { "menus/a.yaml": "server", "menus/b.yaml": "import", "menus/c.yaml": "server" },
        conflicts,
      ),
    ).toBe(true);
  });
});
