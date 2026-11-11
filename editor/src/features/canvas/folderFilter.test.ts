import type { Project } from "@/domain/types";
import { expect, it } from "vitest";
import type { ProjectBoard } from "./autoLayout";
import { activeBoardFolder, boardForFolder, folderAt } from "./folderFilter";

const project = {
  documents: {
    menu: [{ id: "a", folder: "boutique" }, { id: "b", folder: "boutique/armes" }, { id: "c" }],
    command: [{ id: "q", folder: "quetes" }],
  },
} as unknown as Project;

const frame = (id: string) => ({ key: id, id, kind: "group" }) as ProjectBoard["groups"][number];

const board = {
  layout: {
    "menu/a": { x: 0, y: 0 },
    "menu/b": { x: 1, y: 1 },
    "menu/c": { x: 2, y: 2 },
    "command/q": { x: 3, y: 3 },
  },
  groups: [frame("boutique"), frame("quetes")],
} as unknown as ProjectBoard;

it("keeps a top-level folder's Documents, sub-folders included, and its frame", () => {
  const narrowed = boardForFolder(project, board, "boutique");
  expect(Object.keys(narrowed.layout)).toEqual(["menu/a", "menu/b"]);
  expect(narrowed.layout["menu/b"]).toEqual(board.layout["menu/b"]);
  expect(narrowed.groups.map((g) => g.id)).toEqual(["boutique"]);
});

it("keeps a sub-folder's Documents without any frame", () => {
  const narrowed = boardForFolder(project, board, "boutique/armes");
  expect(Object.keys(narrowed.layout)).toEqual(["menu/b"]);
  expect(narrowed.groups).toEqual([]);
});

it("drops a filter whose folder is gone", () => {
  expect(activeBoardFolder(project, "boutique/armes")).toBe("boutique/armes");
  expect(activeBoardFolder(project, "gone")).toBeUndefined();
  expect(activeBoardFolder(project, undefined)).toBeUndefined();
});

it("finds the folder frame under a point, not the project's", () => {
  const groups = [
    { ...frame("boutique"), x: 0, y: 0, width: 100, height: 50 },
    { key: "p", id: "p", kind: "project", x: -500, y: -500, width: 2000, height: 2000 },
  ] as unknown as ProjectBoard["groups"];
  expect(folderAt(groups, { x: 50, y: 25 })).toBe("boutique");
  expect(folderAt(groups, { x: 150, y: 25 })).toBeUndefined();
});
