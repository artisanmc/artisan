import * as api from "@/lib/api/projectVersions";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectHistory } from "./ProjectHistory";
import { projectTree } from "./saveProjectToDisk";

vi.mock("@/lib/api/projectVersions", () => ({
  listProjectVersions: vi.fn(),
  readProjectVersion: vi.fn(),
}));

it("lists deployments and server edits, shows a Version's diff, and restores it into the draft", async () => {
  const previous = useAccountStore.getState().account;
  const account = mockAccount();
  const project = account.projects[0]!;
  const tree = projectTree(project);
  const dropped = Object.keys(tree).find((path) => path !== "manifest.yaml")!;
  const kept = Object.entries(tree).filter(([path]) => path !== dropped);
  vi.mocked(api.listProjectVersions).mockResolvedValue([
    {
      id: "v2",
      hash: "H2",
      createdAt: "2026-09-27T10:00:00Z",
      author: { id: "a", name: "Alice" },
      changed: ["manifest.yaml"],
    },
    { id: "v1", hash: "H1", createdAt: "2026-09-26T10:00:00Z", author: null, changed: [] },
  ]);
  vi.mocked(api.readProjectVersion).mockImplementation(async (_projectId, versionId) =>
    versionId === "v1"
      ? {
          id: "v1",
          createdAt: "2026-09-26T10:00:00Z",
          previousId: "v0",
          files: kept.map(([path, content]) => ({ path, content })),
          binaries: [],
        }
      : {
          id: "v0",
          createdAt: "2026-09-25T10:00:00Z",
          previousId: null,
          files: [
            ...kept.map(([path, content]) => ({ path, content })),
            { path: "old.yaml", content: "x: 1\n" },
          ],
          binaries: [],
        },
  );
  try {
    useAccountStore.setState({ account });
    render(<ProjectHistory projectId={project.id} active />);
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Deployment|Déploiement/)).toBeInTheDocument();
    expect(screen.getByText(/Server edit|Modif\. serveur/)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: /See changes|Voir les changements/ })[1]!,
    );
    const dialog = await screen.findByRole("dialog");
    // The diff compares v1 to the previous Version (v0), which had old.yaml.
    expect(await within(dialog).findByText("old.yaml")).toBeInTheDocument();
    expect(api.readProjectVersion).toHaveBeenCalledWith(project.id, "v0");

    fireEvent.click(within(dialog).getByRole("button", { name: /Restore|Restaurer/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const restored = useAccountStore.getState().account.projects.find((p) => p.id === project.id)!;
    expect(Object.keys(projectTree(restored)).sort()).toEqual(kept.map(([path]) => path).sort());
  } finally {
    act(() => useAccountStore.setState({ account: previous }));
  }
});
