import { expect, it } from "vitest";
import { folderGroups } from "./canvasGroups";
import type { Project } from "./types";

const doc = (id: string, folder?: string) => ({ id, ...(folder ? { folder } : {}) });

function project(folders?: Project["folders"]): Pick<Project, "documents" | "folders"> {
  return {
    documents: {
      menu: [doc("a", "boutique"), doc("b", "boutique/armes"), doc("c")],
      command: [doc("shop", "boutique"), doc("q", "quetes")],
    },
    folders,
  } as unknown as Pick<Project, "documents" | "folders">;
}

it("frames each top-level folder with every Document filed under it, at any depth", () => {
  expect(folderGroups(project())).toEqual([
    { id: "boutique", name: "boutique", nodeIds: ["menu/a", "menu/b", "command/shop"] },
    { id: "quetes", name: "quetes", nodeIds: ["command/q"] },
  ]);
});

it("takes color and position from the folder metadata, and skips empty folders", () => {
  const groups = folderGroups(
    project({
      boutique: { color: "#a855f7", position: { x: 10, y: 20 } },
      vide: { color: "#000000" },
    }),
  );
  expect(groups.map((g) => g.id)).toEqual(["boutique", "quetes"]);
  expect(groups[0]).toMatchObject({ color: "#a855f7", position: { x: 10, y: 20 } });
});
