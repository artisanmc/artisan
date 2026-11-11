import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import type Konva from "konva";
import { beforeEach, expect, it } from "vitest";
import { projectBoard } from "./autoLayout";
import { commitNodeDrag } from "./commitNodeDrag";

const pid = projectId("p_personal");
const project = () => useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;
const folderOf = (id: string) => project().documents.menu!.find((m) => m.id === id)?.folder;

/** A dragged node released at (x, y), the pointer at `at` on a stage with or without frames. */
function node(x: number, y: number, at: { x: number; y: number }, frames = true) {
  const stage = { findOne: () => (frames ? {} : undefined), getRelativePointerPosition: () => at };
  return { x: () => x, y: () => y, getStage: () => stage } as unknown as Konva.Node;
}

beforeEach(() => {
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  for (const id of ["craft_a", "loose"]) store.createMenu({ projectId: pid, id });
  store.createFolder({ projectId: pid, parent: "", name: "crafts" });
  store.moveToFolder({ projectId: pid, nodeIds: ["menu/craft_a"], folder: "crafts" });
});

const frame = () => projectBoard(project()).groups.find((g) => g.id === "crafts")!;
const inside = () => ({ x: frame().x + 10, y: frame().y + 10 });

it("files a node dropped on another folder's frame there", () => {
  commitNodeDrag(pid, "menu/loose", node(0, 0, inside()));
  expect(folderOf("loose")).toBe("crafts");
});

it("only moves a node dropped outside every frame", () => {
  const away = { x: frame().x - 5000, y: frame().y - 5000 };
  commitNodeDrag(pid, "menu/loose", node(away.x, away.y, away));
  expect(folderOf("loose")).toBeUndefined();
  expect(project().canvasLayout["menu/loose"]).toEqual(away);
});

it("files nothing in the focus view, which draws no frame", () => {
  commitNodeDrag(pid, "menu/loose", node(1, 2, inside(), false));
  expect(folderOf("loose")).toBeUndefined();
  expect(project().canvasLayout["menu/loose"]).toEqual({ x: 1, y: 2 });
});
