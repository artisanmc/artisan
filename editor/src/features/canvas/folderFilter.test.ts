import type { Project } from "@/domain/types";
import { expect, it } from "vitest";
import type { ProjectBoard } from "./autoLayout";
import { activeBoardFolder, boardForFolder } from "./folderFilter";

const project = {
  documents: {
    menu: [{ id: "a", folder: "boutique" }, { id: "b", folder: "boutique/armes" }, { id: "c" }],
    command: [{ id: "q", folder: "quetes" }],
  },
} as unknown as Project;

const frame = (id: string) => ({ key: id, id, kind: "group" }) as ProjectBoard["groups"][number];

const board = {
  layout: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 }, q: { x: 3, y: 3 } },
  groups: [frame("boutique"), frame("quetes")],
} as unknown as ProjectBoard;

it("keeps a top-level folder's Documents, sub-folders included, and its frame", () => {
  const narrowed = boardForFolder(project, board, "boutique");
  expect(Object.keys(narrowed.layout)).toEqual(["a", "b"]);
  expect(narrowed.layout.b).toEqual(board.layout.b);
  expect(narrowed.groups.map((g) => g.id)).toEqual(["boutique"]);
});

it("keeps a sub-folder's Documents without any frame", () => {
  const narrowed = boardForFolder(project, board, "boutique/armes");
  expect(Object.keys(narrowed.layout)).toEqual(["b"]);
  expect(narrowed.groups).toEqual([]);
});

it("drops a filter whose folder is gone", () => {
  expect(activeBoardFolder(project, "boutique/armes")).toBe("boutique/armes");
  expect(activeBoardFolder(project, "gone")).toBeUndefined();
  expect(activeBoardFolder(project, undefined)).toBeUndefined();
});
