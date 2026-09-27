import * as api from "@/lib/api/projectVersions";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectVersions } from "./ProjectVersions";
import { projectTree } from "./saveProjectToDisk";

vi.mock("@/lib/api/projectVersions", () => ({
  listProjectVersions: vi.fn(),
  readProjectVersion: vi.fn(),
}));

it("restores an older Version into the editor without writing to the server", async () => {
  const previous = useAccountStore.getState().account;
  const account = mockAccount();
  const project = account.projects[0]!;
  const tree = projectTree(project);
  const dropped = Object.keys(tree).find((path) => path !== "manifest.yaml")!;
  const kept = Object.entries(tree).filter(([path]) => path !== dropped);
  vi.mocked(api.listProjectVersions).mockResolvedValue([
    { id: "v2", hash: "H2", createdAt: "2026-09-27T10:00:00Z", author: { id: "a", name: "Alice" }, changed: ["manifest.yaml"] },
    { id: "v1", hash: "H1", createdAt: "2026-09-26T10:00:00Z", author: null, changed: [] },
  ]);
  vi.mocked(api.readProjectVersion).mockResolvedValue({
    id: "v1",
    createdAt: "2026-09-26T10:00:00Z",
    files: kept.map(([path, content]) => ({ path, content })),
  });
  const onRestored = vi.fn();
  try {
    useAccountStore.setState({ account });
    render(<ProjectVersions projectId={project.id} onRestored={onRestored} />);
    fireEvent.click(screen.getByRole("button", { name: /Show versions|Afficher les versions/ }));
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/The server|Le serveur/)).toBeInTheDocument();
    // La plus récente est l'actuelle : on ne restaure que les précédentes.
    const restore = screen.getAllByRole("button", { name: /^(Restore|Restaurer)$/ });
    expect(restore).toHaveLength(1);
    fireEvent.click(restore[0]!);
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    const restored = useAccountStore.getState().account.projects.find((p) => p.id === project.id)!;
    expect(dropped).toBeDefined();
    expect(Object.keys(projectTree(restored)).sort()).toEqual(kept.map(([path]) => path).sort());
  } finally {
    act(() => useAccountStore.setState({ account: previous }));
  }
});
