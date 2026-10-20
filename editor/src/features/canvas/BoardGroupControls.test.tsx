import { folderGroups } from "@/domain/canvasGroups";
import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { BoardGroupControls, type GroupDialogState } from "./BoardGroupControls";
import { projectBoard } from "./autoLayout";

it("files the selected menus in a new folder through the canvas controls", async () => {
  const pid = projectId("p_personal");
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  for (const id of ["craft_a", "craft_b"])
    useProjectsStore.getState().createMenu({ projectId: pid, id });
  useSelectionStore.getState().set(["craft_a", "craft_b"]);
  function Harness() {
    const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === pid)!);
    const [dialog, setDialog] = useState<GroupDialogState>(null);
    return <BoardGroupControls project={project} dialog={dialog} onDialogChange={setDialog} />;
  }
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(
    screen.getByRole("button", { name: /Ranger dans un dossier|File in a folder/i }),
  );
  await user.type(screen.getByRole("combobox", { name: /^(Dossier|Folder)$/i }), "Crafts!");
  fireEvent.change(screen.getByLabelText(/Couleur du cadre|Frame color/i), {
    target: { value: "#a855f7" },
  });
  await user.click(screen.getByRole("button", { name: /^(Ranger|File)$/i }));
  expect(
    folderGroups(useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!),
  ).toEqual([
    expect.objectContaining({ name: "crafts", nodeIds: ["craft_a", "craft_b"], color: "#a855f7" }),
  ]);
});

it("files a command and a menu from the selection", async () => {
  const pid = projectId("p_personal");
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  store.createMenu({ projectId: pid, id: "craft_a" });
  const cmdId = store.createCommand({ projectId: pid, id: "cmd_a" });
  useSelectionStore.getState().set(["craft_a", cmdId]);
  function Harness() {
    const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === pid)!);
    const [dialog, setDialog] = useState<GroupDialogState>(null);
    return <BoardGroupControls project={project} dialog={dialog} onDialogChange={setDialog} />;
  }
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(
    screen.getByRole("button", { name: /Ranger dans un dossier|File in a folder/i }),
  );
  await user.type(screen.getByRole("combobox", { name: /^(Dossier|Folder)$/i }), "Mixed");
  await user.click(screen.getByRole("button", { name: /^(Ranger|File)$/i }));
  expect(
    folderGroups(useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!),
  ).toEqual([expect.objectContaining({ name: "mixed", nodeIds: ["craft_a", cmdId] })]);
});

it("rearranges a folder frame's contents from its menu", async () => {
  const pid = projectId("p_personal");
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  for (const id of ["craft_a", "craft_b"]) store.createMenu({ projectId: pid, id });
  const groupId = store.createFolder({ projectId: pid, parent: "", name: "crafts" });
  store.moveToFolder({ projectId: pid, nodeIds: ["craft_a", "craft_b"], folder: groupId });
  store.setCanvasPosition({ projectId: pid, nodeId: "craft_b", x: 5000, y: 3000 });
  const project = () =>
    useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;
  const before = projectBoard(project());
  render(<BoardGroupControls project={project()} dialog={null} onDialogChange={() => {}} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^(Dossiers|Folders)$/i }));
  await user.click(screen.getByRole("menuitem", { name: "crafts" }));
  const action = await screen.findByRole("menuitem", {
    name: /Réarranger le contenu|Rearrange contents/i,
  });
  action.focus();
  await user.keyboard("{Enter}");
  expect(projectBoard(project()).layout.craft_b).not.toEqual(before.layout.craft_b);
  const frame = before.groups.find((g) => g.id === groupId)!;
  expect(projectBoard(project()).groups.find((g) => g.id === groupId)).toMatchObject({
    x: frame.x,
    y: frame.y,
  });
});

it("edits a folder's color and supports undo", async () => {
  const pid = projectId("p_personal");
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  for (const id of ["craft_a", "craft_b"]) store.createMenu({ projectId: pid, id });
  const groupId = store.createFolder({ projectId: pid, parent: "", name: "crafts" });
  store.moveToFolder({ projectId: pid, nodeIds: ["craft_a", "craft_b"], folder: groupId });
  store.setFolderColor({ projectId: pid, path: groupId, color: "#a855f7" });
  const project = () =>
    useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;
  render(<BoardGroupControls project={project()} dialog={{ groupId }} onDialogChange={() => {}} />);
  const input = screen.getByLabelText(/Couleur du cadre|Frame color/i);
  expect(input).toHaveValue("#a855f7");
  fireEvent.change(input, { target: { value: "#22c55e" } });
  await userEvent.setup().click(screen.getByRole("button", { name: /Enregistrer|Save/i }));
  expect(project().folders?.crafts?.color).toBe("#22c55e");
  useProjectsStore.temporal.getState().undo();
  expect(project().folders?.crafts?.color).toBe("#a855f7");
});
