import { mockAccount } from "@/mock/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectProperties } from "./ProjectProperties";

vi.mock("@/features/account/DeleteProjectDialog", () => ({ DeleteProjectDialog: () => null }));
afterEach(cleanup);

it("shows the current folder ID instead of the immutable anchor after rename", () => {
  const project = mockAccount().projects[0]!;
  project.diskId = "principal";
  project.name = "Mon projet";
  render(<ProjectProperties project={project} />);
  expect(screen.getByText("principal")).toBeInTheDocument();
  expect(screen.queryByText(project.id)).not.toBeInTheDocument();
});
