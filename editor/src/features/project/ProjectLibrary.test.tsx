import type { ProjectId } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/canvas/Library", () => ({ Library: () => <div>Item catalogue</div> }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>Graphics catalogue</div> }));
vi.mock("@/features/canvas/CapturedItemsSection", () => ({
  CapturedItemsSection: () => <div>Captured catalogue</div>,
}));

import { ProjectLibraryButton, ProjectLibraryWorkspace } from "./ProjectLibrary";
import { useProjectLibraryStore } from "./projectLibraryStore";

const PID = "p1" as ProjectId;

beforeEach(() => {
  useSelectionStore.getState().clear();
  useProjectLibraryStore.getState().close();
});

function Workspace({ projectId = PID }: { projectId?: ProjectId }) {
  return (
    <>
      <ProjectLibraryButton projectId={projectId} />
      <ProjectLibraryWorkspace projectId={projectId}>
        <div>Canvas and properties</div>
      </ProjectLibraryWorkspace>
    </>
  );
}

it("opens the project library without a selection, beside the existing workspace", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /bibliothèque|library/i }));
  expect(screen.getByText("Item catalogue")).toBeInTheDocument();
  expect(screen.getByText("Canvas and properties")).toBeInTheDocument();
  expect(useSelectionStore.getState().ids.size).toBe(0);

  await user.click(screen.getByRole("tab", { name: /ressources graphiques|graphics/i }));
  expect(screen.getByText("Graphics catalogue")).toBeInTheDocument();

  act(() => useSelectionStore.getState().set(["command1"]));
  expect(screen.getByText("Graphics catalogue")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /fermer la bibliothèque|close library/i }));
  expect(screen.queryByText("Graphics catalogue")).not.toBeInTheDocument();
  expect([...useSelectionStore.getState().ids]).toEqual(["command1"]);
});

it("keeps captured items inside Items", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /bibliothèque|library/i }));
  await user.click(screen.getByRole("button", { name: /capturés|captured/i }));
  expect(screen.getByText("Captured catalogue")).toBeInTheDocument();
});

it("does not carry an open catalogue into a different project", async () => {
  const user = userEvent.setup();
  const view = render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /bibliothèque|library/i }));
  view.rerender(<Workspace projectId={"p2" as ProjectId} />);
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
});

it("Escape closes the library before document navigation", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /bibliothèque|library/i }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
});

it("reopens the library from another workspace view instead of closing a hidden panel", async () => {
  const onOpen = vi.fn();
  useProjectLibraryStore.getState().open(PID, "graphics");
  render(<ProjectLibraryButton projectId={PID} active={false} onOpen={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: /bibliothèque|library/i }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(useProjectLibraryStore.getState().projectId).toBe(PID);
});
