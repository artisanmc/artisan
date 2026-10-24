import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { FolderProperties } from "./FolderProperties";

const pid = projectId("p_personal");
const project = () => useProjectsStore.getState().openProjects.projects.find((p) => p.id === pid)!;

beforeEach(() => {
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  for (const id of ["craft_a", "craft_b"]) store.createMenu({ projectId: pid, id });
  store.createFolder({ projectId: pid, parent: "", name: "crafts" });
  store.moveToFolder({
    projectId: pid,
    nodeIds: ["menu/craft_a", "menu/craft_b"],
    folder: "crafts",
  });
  store.setFolderColor({ projectId: pid, path: "crafts", color: "#a855f7" });
});

it("edits a folder's frame color, undoably", () => {
  render(<FolderProperties project={project()} path="crafts" />);
  const input = screen.getByLabelText(/Couleur du cadre|Frame color/i);
  expect(input).toHaveValue("#a855f7");
  fireEvent.change(input, { target: { value: "#22c55e" } });
  expect(project().folders?.crafts?.color).toBe("#22c55e");
  useProjectsStore.temporal.getState().undo();
  expect(project().folders?.crafts?.color).toBe("#a855f7");
});

it("renames the folder when its name field is left, and keeps it selected", () => {
  useSelectionStore.getState().selectFolder("crafts");
  render(<FolderProperties project={project()} path="crafts" />);
  const input = screen.getByLabelText(/Nom du dossier|Folder name/i);
  fireEvent.change(input, { target: { value: "ateliers" } });
  fireEvent.blur(input);
  expect(project().documents.menu!.find((m) => m.id === "craft_a")?.folder).toBe("ateliers");
  expect(useSelectionStore.getState().folder).toBe("ateliers");
});
