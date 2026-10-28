import { folderGroups } from "@/domain/canvasGroups";
import { menusOf, parseDocKey, resolveDocKey } from "@/domain/documents";
import { menuId, projectId } from "@/domain/ids";
import { projectBoard } from "@/features/canvas/autoLayout";
import { mockOpenProjects } from "@/mock/fixtures";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { beforeEach, expect, it } from "vitest";
import { useProjectsStore } from "./projectsStore";

const pid = projectId("p_personal");
const project = () => useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;

/** Files Documents (by id) in a new top-level folder: its board frame. */
function fileIn(name: string, ids: string[]) {
  const store = useProjectsStore.getState();
  const path = store.createFolder({ projectId: pid, parent: "", name });
  const nodeIds = ids.map((id) => resolveDocKey(project(), id)!);
  store.moveToFolder({ projectId: pid, nodeIds, folder: path });
  return path;
}

/** Each frame's Documents, by id. */
const frameIds = () =>
  Object.fromEntries(
    folderGroups(project()).map((g) => [g.id, g.nodeIds.map((k) => parseDocKey(k)!.id)]),
  );

function customizedGroup() {
  const store = useProjectsStore.getState();
  const id = fileIn("crafts", ["craft_a", "craft_b"]);
  store.setCanvasPosition({ projectId: pid, nodeId: "menu/craft_a", x: 4000, y: 2400 });
  store.setCanvasPosition({ projectId: pid, nodeId: "menu/craft_b", x: 4100, y: 3100 });
  return id;
}

function relative(board: ReturnType<typeof projectBoard>, groupId: string) {
  const frame = board.groups.find((g) => g.id === groupId)!;
  return Object.fromEntries(
    frame.members.map((id) => [
      id,
      {
        x: board.layout[id]!.x - frame.x,
        y: board.layout[id]!.y - frame.y,
      },
    ]),
  );
}
beforeEach(() => {
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  for (const id of ["craft_a", "craft_b", "craft_c"]) {
    useProjectsStore.getState().createMenu({ projectId: pid, id });
  }
  useProjectsStore.temporal.getState().clear();
});

it("moves a folder frame as one undoable operation", () => {
  const store = useProjectsStore.getState();
  const id = fileIn("crafts", ["craft_a", "craft_b"]);
  const before = projectBoard(project());
  store.moveCanvasGroup({ projectId: pid, groupId: id, dx: 400, dy: 180 });
  const after = projectBoard(project());
  for (const key of ["menu/craft_a", "menu/craft_b"]) {
    expect(after.layout[key]).toEqual({
      x: before.layout[key]!.x + 400,
      y: before.layout[key]!.y + 180,
    });
  }
  useProjectsStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});

it("files selected menus in a folder, survives rename, and undoes without touching menus", () => {
  const before = structuredClone(menusOf(project())).map(({ folder: _, ...m }) => m);
  fileIn("crafts", ["craft_a", "craft_b"]);
  expect(frameIds()).toEqual({ crafts: ["craft_a", "craft_b"] });
  expect(menusOf(project()).map(({ folder: _, ...m }) => m)).toEqual(before);
  useProjectsStore.temporal.getState().undo();
  expect(frameIds()).toEqual({});
  useProjectsStore.temporal.getState().redo();
  useProjectsStore
    .getState()
    .setMenuId({ projectId: pid, oldId: menuId("craft_a"), newId: menuId("craft_new") });
  expect(frameIds().crafts).toEqual(["craft_new", "craft_b"]);
});

it("keeps one folder per Document, colors, renames and deletes a folder", () => {
  const store = useProjectsStore.getState();
  fileIn("first", ["craft_a", "craft_b"]);
  fileIn("second", ["craft_b", "craft_c"]);
  expect(frameIds()).toEqual({ first: ["craft_a"], second: ["craft_b", "craft_c"] });
  store.setFolderColor({ projectId: pid, path: "second", color: "#a855f7" });
  expect(store.renameFolder({ projectId: pid, path: "second", name: "crafts" })).toBe("crafts");
  expect(folderGroups(project()).find((g) => g.id === "crafts")).toMatchObject({
    color: "#a855f7",
    nodeIds: ["menu/craft_b", "menu/craft_c"],
  });
  store.deleteFromProject({ projectId: pid, nodeIds: ["menu/craft_a"] });
  expect(Object.keys(frameIds())).toEqual(["crafts"]);
  store.deleteFolder({ projectId: pid, path: "crafts" });
  expect(frameIds()).toEqual({});
  expect(project().folders).toEqual({ first: {} });
  expect(menusOf(project()).map((m) => m.id)).toEqual(
    expect.arrayContaining(["craft_b", "craft_c"]),
  );
});

it("files commands and dialogs alongside menus, and keeps a renamed command in its folder", () => {
  const store = useProjectsStore.getState();
  const cmdId = store.createCommand({ projectId: pid, id: "cmd_a" });
  const dlgId = store.createDialog({ projectId: pid, id: "dlg_a" });
  const groupId = fileIn("mixed", ["craft_a", cmdId, dlgId]);
  expect(frameIds()[groupId]).toEqual(["craft_a", cmdId, dlgId]);
  const board = projectBoard(project());
  const frame = board.groups.find((g) => g.id === groupId)!;
  for (const key of [`command/${cmdId}`, `dialog/${dlgId}`]) {
    const pos = board.layout[key]!;
    expect(pos.x).toBeGreaterThan(frame.x);
    expect(pos.x).toBeLessThan(frame.x + frame.width);
  }
  store.setCommandId({ projectId: pid, oldId: cmdId, newId: "cmd_renamed" as never });
  expect(frameIds()[groupId]).toContain("cmd_renamed");
  expect(frameIds()[groupId]).not.toContain(cmdId);
});

it("rearranges the board as blocks without changing group interiors, including after reload", () => {
  const id = customizedGroup();
  const before = projectBoard(project());
  const documents = structuredClone(menusOf(project()));
  const store = useProjectsStore.getState();
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "menu/craft_a->menu/craft_b",
    end: "from",
    anchor: { side: "bottom", t: 0.3 },
  });
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "menu/craft_b->menu/craft_c",
    end: "from",
    anchor: { side: "top", t: 0.7 },
  });
  store.releaseBoardPositions({ projectId: pid });
  const after = projectBoard(project());
  expect(relative(after, id)).toEqual(relative(before, id));
  expect(after.layout["menu/craft_a"]).not.toEqual(before.layout["menu/craft_a"]);
  expect(project().canvasEdges).toEqual({
    "menu/craft_a->menu/craft_b": { from: { side: "bottom", t: 0.3 } },
  });
  expect(menusOf(project())).toEqual(documents);
  const restored = projectFromFiles(pid, projectToFiles(project()));
  expect(relative(projectBoard(restored), id)).toEqual(relative(after, id));
  store.releaseBoardPositions({ projectId: pid });
  expect(projectBoard(project()).layout).toEqual(after.layout);
  useProjectsStore.temporal.getState().undo();
  useProjectsStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});

it("rearranges only the chosen group's contents, keeping its origin and all other documents fixed", () => {
  const id = customizedGroup();
  const store = useProjectsStore.getState();
  store.createMenu({ projectId: pid, id: "craft_d" });
  const other = fileIn("other", ["craft_c", "craft_d"]);
  const before = projectBoard(project());
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "menu/craft_a->menu/craft_b",
    end: "from",
    anchor: { side: "bottom", t: 0.3 },
  });
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "menu/craft_c->menu/craft_d",
    end: "from",
    anchor: { side: "top", t: 0.7 },
  });
  store.rearrangeCanvasGroup({ projectId: pid, groupId: id });
  const after = projectBoard(project());
  const frame = before.groups.find((g) => g.id === id)!;
  expect(after.groups.find((g) => g.id === id)).toMatchObject({ x: frame.x, y: frame.y });
  expect(relative(after, id)).not.toEqual(relative(before, id));
  for (const [key, position] of Object.entries(before.layout)) {
    if (!frame.members.includes(key)) expect(after.layout[key]).toEqual(position);
  }
  expect(after.groups.find((g) => g.id === other)).toEqual(
    before.groups.find((g) => g.id === other),
  );
  expect(project().canvasEdges).toEqual({
    "menu/craft_c->menu/craft_d": { from: { side: "top", t: 0.7 } },
  });
  useProjectsStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});
