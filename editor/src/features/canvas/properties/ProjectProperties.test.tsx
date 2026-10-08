import { mockAccount } from "@/mock/fixtures";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectProperties } from "./ProjectProperties";

vi.mock("@/features/account/DeleteProjectDialog", () => ({ DeleteProjectDialog: () => null }));
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("shows the current folder ID instead of the immutable anchor after rename", () => {
  const project = mockAccount().projects[0]!;
  project.diskId = "principal";
  project.name = "Mon projet";
  render(<ProjectProperties project={project} />);
  expect(screen.getByText("principal")).toBeInTheDocument();
  expect(screen.queryByText(project.id)).not.toBeInTheDocument();
});

it("offers to edit the ID next to it when the server allows renaming", () => {
  const project = mockAccount().projects[0]!;
  useProjectRuntimeStore.getState().set({
    projectId: project.id,
    networkId: "network",
    serverId: "server",
    minecraftVersion: null,
    capabilities: { canRename: true, liveData: true, captureInGame: true, preview: true },
    connection: { available: true },
  });
  render(<ProjectProperties project={project} />);
  expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  useProjectRuntimeStore.getState().set(null);
});

it("hides the ID edit without the rename capability", () => {
  render(<ProjectProperties project={mockAccount().projects[0]!} />);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});
