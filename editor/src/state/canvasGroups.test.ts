import { menuId, projectId } from "@/domain/ids";
import { projectBoard } from "@/features/canvas/autoLayout";
import { transform } from "@/features/export/transform";
import { mockAccount } from "@/mock/fixtures";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { beforeEach, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const pid = projectId("p_personal");
const project = () => useAccountStore.getState().account.projects.find((p) => p.id === pid)!;

function customizedGroup() {
  const store = useAccountStore.getState();
  const id = store.createCanvasGroup({
    projectId: pid,
    name: "Crafts",
    nodeIds: ["craft_a", "craft_b"],
  });
  store.setCanvasPosition({ projectId: pid, nodeId: "craft_a", x: 4000, y: 2400 });
  store.setCanvasPosition({ projectId: pid, nodeId: "craft_b", x: 4100, y: 3100 });
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
  useAccountStore.setState({ account: mockAccount() });
  for (const id of ["craft_a", "craft_b", "craft_c"]) {
    useAccountStore.getState().createMenu({ projectId: pid, id });
  }
  useAccountStore.temporal.getState().clear();
});

it("moves a group as one undoable operation", () => {
  const store = useAccountStore.getState();
  const id = store.createCanvasGroup({
    projectId: pid,
    name: "Crafts",
    nodeIds: ["craft_a", "craft_b"],
  });
  const before = projectBoard(project());
  store.moveCanvasGroup({ projectId: pid, groupId: id, dx: 400, dy: 180 });
  const after = projectBoard(project());
  for (const key of ["craft_a", "craft_b"]) {
    expect(after.layout[key]).toEqual({
      x: before.layout[key]!.x + 400,
      y: before.layout[key]!.y + 180,
    });
  }
  useAccountStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});

it("groups selected menus, survives rename, and can undo grouping without changing menus", () => {
  const before = structuredClone(project().menus);
  const id = useAccountStore.getState().createCanvasGroup({
    projectId: pid,
    name: "Crafts",
    nodeIds: ["craft_a", "craft_b"],
  });
  expect(project().canvasGroups).toEqual([{ id, name: "Crafts", nodeIds: ["craft_a", "craft_b"] }]);
  expect(project().menus).toEqual(before);
  useAccountStore.temporal.getState().undo();
  expect(project().canvasGroups ?? []).toEqual([]);
  useAccountStore.temporal.getState().redo();
  useAccountStore
    .getState()
    .setMenuId({ projectId: pid, oldId: menuId("craft_a"), newId: menuId("craft_new") });
  expect(project().canvasGroups![0]!.nodeIds).toEqual(["craft_new", "craft_b"]);
});

it("keeps membership exclusive, supports color and dissolve, and prunes deleted menus", () => {
  const store = useAccountStore.getState();
  const first = store.createCanvasGroup({
    projectId: pid,
    name: "First",
    nodeIds: ["craft_a", "craft_b"],
  });
  const second = store.createCanvasGroup({
    projectId: pid,
    name: "Second",
    nodeIds: ["craft_b", "craft_c"],
  });
  expect(project().canvasGroups!.find((g) => g.id === first)!.nodeIds).toEqual(["craft_a"]);
  store.updateCanvasGroup({ projectId: pid, groupId: second, name: "Crafts", color: "#a855f7" });
  expect(project().canvasGroups!.find((g) => g.id === second)).toMatchObject({
    name: "Crafts",
    color: "#a855f7",
  });
  store.deleteFromProject({ projectId: pid, nodeIds: ["craft_a"] });
  expect(project().canvasGroups!.map((g) => g.id)).toEqual([second]);
  store.dissolveCanvasGroup({ projectId: pid, groupId: second });
  expect(project().canvasGroups).toEqual([]);
  expect(project().menus.map((m) => m.id)).toEqual(expect.arrayContaining(["craft_b", "craft_c"]));
});

it("groups commands and dialogs alongside menus, and rekeys a renamed command", () => {
  const store = useAccountStore.getState();
  const cmdId = store.createCommand({ projectId: pid, id: "cmd_a" });
  const dlgId = store.createDialog({ projectId: pid, id: "dlg_a" });
  const groupId = store.createCanvasGroup({
    projectId: pid,
    name: "Mixed",
    nodeIds: ["craft_a", cmdId, dlgId],
  });
  expect(project().canvasGroups!.find((g) => g.id === groupId)!.nodeIds).toEqual([
    "craft_a",
    cmdId,
    dlgId,
  ]);
  const board = projectBoard(project());
  const frame = board.groups.find((g) => g.id === groupId)!;
  for (const key of [cmdId, dlgId]) {
    const pos = board.layout[key]!;
    expect(pos.x).toBeGreaterThan(frame.x);
    expect(pos.x).toBeLessThan(frame.x + frame.width);
  }
  store.setCommandId({ projectId: pid, oldId: cmdId, newId: "cmd_renamed" as never });
  expect(project().canvasGroups!.find((g) => g.id === groupId)!.nodeIds).toContain("cmd_renamed");
  expect(project().canvasGroups!.find((g) => g.id === groupId)!.nodeIds).not.toContain(cmdId);
});

it("rearranges the board as blocks without changing group interiors, including after reload", () => {
  const id = customizedGroup();
  const before = projectBoard(project());
  const documents = structuredClone(project().menus);
  const store = useAccountStore.getState();
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "craft_a->craft_b",
    end: "from",
    anchor: { side: "bottom", t: 0.3 },
  });
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "craft_b->craft_c",
    end: "from",
    anchor: { side: "top", t: 0.7 },
  });
  store.releaseBoardPositions({ projectId: pid });
  const after = projectBoard(project());
  expect(relative(after, id)).toEqual(relative(before, id));
  expect(after.layout.craft_a).not.toEqual(before.layout.craft_a);
  expect(project().canvasEdges).toEqual({
    "craft_a->craft_b": { from: { side: "bottom", t: 0.3 } },
  });
  expect(project().menus).toEqual(documents);
  const restored = projectFromFiles(pid, transform(project()));
  expect(relative(projectBoard(restored), id)).toEqual(relative(after, id));
  store.releaseBoardPositions({ projectId: pid });
  expect(projectBoard(project()).layout).toEqual(after.layout);
  useAccountStore.temporal.getState().undo();
  useAccountStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});

it("rearranges only the chosen group's contents, keeping its origin and all other documents fixed", () => {
  const id = customizedGroup();
  const store = useAccountStore.getState();
  store.createMenu({ projectId: pid, id: "craft_d" });
  const other = store.createCanvasGroup({
    projectId: pid,
    name: "Other",
    nodeIds: ["craft_c", "craft_d"],
  });
  const before = projectBoard(project());
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "craft_a->craft_b",
    end: "from",
    anchor: { side: "bottom", t: 0.3 },
  });
  store.setEdgeAnchor({
    projectId: pid,
    edgeId: "craft_c->craft_d",
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
  expect(project().canvasEdges).toEqual({ "craft_c->craft_d": { from: { side: "top", t: 0.7 } } });
  useAccountStore.temporal.getState().undo();
  expect(projectBoard(project()).layout).toEqual(before.layout);
});
