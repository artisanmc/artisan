import * as api from "@/lib/api/projectVersions";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectHistory } from "./ProjectHistory";
import { mutateDraftAssets } from "./persistedDrafts";
import { projectTree } from "./saveProjectToDisk";

vi.mock("@/lib/api/projectVersions", () => ({
  listProjectVersions: vi.fn(),
  readProjectVersion: vi.fn(),
}));
vi.mock("./persistedDrafts", () => ({ mutateDraftAssets: vi.fn().mockResolvedValue({}) }));

it("lists deployments and server edits, shows a Version's diff, and restores it into the draft", async () => {
  const previous = useProjectsStore.getState().openProjects;
  const openProjects = mockOpenProjects();
  const project = openProjects.projects[0]!;
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
    useProjectsStore.setState({ openProjects });
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

    const opened = vi.fn();
    window.addEventListener("artisan:open-deploy-review", opened);
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Restore and publish|Restaurer et publier/ }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    window.removeEventListener("artisan:open-deploy-review", opened);
    const restored = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === project.id)!;
    expect(Object.keys(projectTree(restored)).sort()).toEqual(kept.map(([path]) => path).sort());
    expect(vi.mocked(mutateDraftAssets).mock.calls[0]![1]).toMatchObject({
      suffix: "/restore",
      fields: { versionId: "v1" },
    });
    expect(opened).toHaveBeenCalledOnce();
  } finally {
    act(() => useProjectsStore.setState({ openProjects: previous }));
  }
});
