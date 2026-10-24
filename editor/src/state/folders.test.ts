import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { beforeEach, expect, it } from "vitest";
import { useProjectDraftStore } from "./projectDraftStore";
import { FolderOperationError } from "./projects/foldersSlice";
import { useProjectsStore } from "./projectsStore";

const pid = projectId("p_personal");
const project = () => useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;
const folderOf = (id: string) =>
  Object.values(project().documents)
    .flat()
    .find((d) => d.id === id)?.folder;
const renames = () => useProjectDraftStore.getState().pendingRenames[pid] ?? [];

beforeEach(() => {
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  useProjectDraftStore.getState().clear(pid);
  const store = useProjectsStore.getState();
  store.createMenu({ projectId: pid, id: "shop" });
  store.createCommand({ projectId: pid, id: "sell" });
});

it("creates nested folders up to three levels, refusing bad names and duplicates", () => {
  const store = useProjectsStore.getState();
  const top = store.createFolder({ projectId: pid, parent: "", name: "boutique" });
  const mid = store.createFolder({ projectId: pid, parent: top, name: "armes" });
  expect(store.createFolder({ projectId: pid, parent: mid, name: "epees" })).toBe(
    "boutique/armes/epees",
  );
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof FolderOperationError ? e.code : "other";
    }
    return null;
  };
  expect(
    code(() => store.createFolder({ projectId: pid, parent: "boutique/armes/epees", name: "x" })),
  ).toBe("too_deep");
  expect(code(() => store.createFolder({ projectId: pid, parent: "", name: "Boutique" }))).toBe(
    "invalid_name",
  );
  expect(code(() => store.createFolder({ projectId: pid, parent: "", name: "menus" }))).toBe(
    "invalid_name",
  );
  expect(code(() => store.createFolder({ projectId: pid, parent: "", name: "boutique" }))).toBe(
    "exists",
  );
});

it("files Documents of any kind in a folder and records each file move", () => {
  const store = useProjectsStore.getState();
  store.createFolder({ projectId: pid, parent: "", name: "boutique" });
  store.moveToFolder({
    projectId: pid,
    nodeIds: ["menu/shop", "command/sell"],
    folder: "boutique",
  });
  expect([folderOf("shop"), folderOf("sell")]).toEqual(["boutique", "boutique"]);
  expect(renames()).toEqual(
    expect.arrayContaining([
      { from: "menus/shop.yml", to: "boutique/menus/shop.yml" },
      { from: "commands/sell.yml", to: "boutique/commands/sell.yml" },
    ]),
  );
  store.moveToFolder({ projectId: pid, nodeIds: ["menu/shop"], folder: "" });
  expect(folderOf("shop")).toBeUndefined();
  expect(renames()).toEqual([{ from: "commands/sell.yml", to: "boutique/commands/sell.yml" }]);
});

it("renames a folder with its sub-folders and metadata, and the undo restores both", () => {
  const store = useProjectsStore.getState();
  store.createFolder({ projectId: pid, parent: "", name: "boutique" });
  store.createFolder({ projectId: pid, parent: "boutique", name: "armes" });
  store.moveToFolder({ projectId: pid, nodeIds: ["menu/shop"], folder: "boutique/armes" });
  store.setFolderColor({ projectId: pid, path: "boutique", color: "#a855f7" });
  expect(store.renameFolder({ projectId: pid, path: "boutique", name: "magasin" })).toBe("magasin");
  expect(folderOf("shop")).toBe("magasin/armes");
  expect(project().folders?.magasin).toEqual({ color: "#a855f7" });
  expect(project().folders).not.toHaveProperty("boutique");
  expect(renames()).toEqual([{ from: "menus/shop.yml", to: "magasin/armes/menus/shop.yml" }]);
  useProjectsStore.temporal.getState().undo();
  expect(folderOf("shop")).toBe("boutique/armes");
});

it("deletes a folder by lifting what it holds into its parent", () => {
  const store = useProjectsStore.getState();
  store.createFolder({ projectId: pid, parent: "", name: "boutique" });
  store.createFolder({ projectId: pid, parent: "boutique", name: "armes" });
  store.createFolder({ projectId: pid, parent: "boutique/armes", name: "epees" });
  store.moveToFolder({ projectId: pid, nodeIds: ["menu/shop"], folder: "boutique/armes/epees" });
  store.moveToFolder({ projectId: pid, nodeIds: ["command/sell"], folder: "boutique/armes" });
  store.deleteFolder({ projectId: pid, path: "boutique/armes" });
  expect(folderOf("shop")).toBe("boutique/epees");
  expect(folderOf("sell")).toBe("boutique");
  store.deleteFolder({ projectId: pid, path: "boutique" });
  expect([folderOf("shop"), folderOf("sell")]).toEqual(["epees", undefined]);
});
