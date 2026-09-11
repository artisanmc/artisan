import { useProjectDraftStore } from "@/state/projectDraftStore";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BackendDraftControls } from "./BackendDraftControls";
import { useBackendDraftStore } from "./backendDrafts";

it("shows the local recovery status and the proposed file changes before publication", () => {
  useBackendDraftStore.setState({
    sessions: { p1: { ownerId: "u1", drafts: [], status: "conflict" } },
  });
  useProjectDraftStore
    .getState()
    .save("p1", { baseline: { "manifest.yaml": "old" }, tree: { "manifest.yaml": "new" }, at: 1 });
  const { rerender } = render(
    <BackendDraftControls projectId="p1" open={false} onOpenChange={vi.fn()} />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<BackendDraftControls projectId="p1" open onOpenChange={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent(/autre session/i);
  expect(screen.getByText("manifest.yaml")).toBeInTheDocument();
  expect(screen.getByText("old")).toBeInTheDocument();
  expect(screen.getByText("new")).toBeInTheDocument();
});
