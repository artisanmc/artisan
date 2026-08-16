import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectTopBarControls } from "./ProjectTopBarControls";
import { saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import type { Project, ProjectId } from "@/domain/types";

vi.mock("@/features/project/saveProjectToDisk", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/saveProjectToDisk")>(
    "@/features/project/saveProjectToDisk",
  );
  return { ...actual, saveProjectToDisk: vi.fn(async () => ({ ok: true, wrote: 1 })) };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => () => {}, useParams: () => ({}), useSearch: () => ({ tab: "overview" }) };
});

function baseProject(name: string): Project {
  return {
    id: "p1" as ProjectId,
    diskId: "p1",
    name,
    defaultLang: "en",
    i18nKeys: {},
    menus: [],
    commands: [],
    dialogs: [],
    assets: [],
    serverKeyId: "sk1",
  } as unknown as Project;
}

/**
 * Régression : le bouton Enregistrer sérialisait la prop `project`, qui vient
 * d'un `useState` figé au chargement (`useProjectLoader`). Toutes les éditions
 * vivent dans `useAccountStore` — enregistrer écrivait donc le Project tel
 * qu'il était à l'OUVERTURE, et perdait silencieusement tout le travail de la
 * session. Constaté en jeu le 2026-08-13 (un élément ajouté n'apparaissait pas).
 */
describe("ProjectTopBarControls — Enregistrer", () => {
  beforeEach(() => {
    vi.mocked(saveProjectToDisk).mockClear();
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
  });

  it("enregistre l'état VIVANT du store, pas la prop figée au chargement", async () => {
    const stale = baseProject("état au chargement");
    const live = baseProject("état après édition");
    useAccountStore.setState({
      account: { id: "n1", projects: [live], projectOrder: [live.id] },
    } as never);
    // Enregistrer ne s'active que s'il y a du travail en cours : c'est le
    // brouillon qui le dit, donc il faut un brouillon sale pour pouvoir cliquer.
    useProjectDraftStore.getState().save("p1", {
      baseline: { "menus/m.yaml": "a\n" },
      tree: { "menus/m.yaml": "b\n" },
      initialTree: { "menus/m.yaml": "a\n" },
      at: 0,
    });

    render(
      <ProjectTopBarControls project={stale} projectId={"p1" as ProjectId} networkId="n1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^(Save|Enregistrer)/ }));

    await waitFor(() => expect(saveProjectToDisk).toHaveBeenCalled());
    const savedProject = vi.mocked(saveProjectToDisk).mock.calls[0]![0];
    expect(savedProject.name).toBe("état après édition");
  });

  /**
   * Le bouton porte à lui seul l'état « as-tu du travail en cours ? » : actif
   * s'il y a quelque chose à écrire, inactif sinon. C'est ce qui a remplacé le
   * bandeau, puis le petit « non enregistré » à côté — un bouton qui ne fait
   * rien dit déjà qu'il n'y a rien à faire.
   */
  it("est inactif quand rien n'a été modifié depuis le chargement", () => {
    const p = baseProject("intact");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    const tree = { "menus/m.yaml": "a\n" };
    useProjectDraftStore.getState().save("p1", {
      baseline: tree,
      tree,
      initialTree: { ...tree },
      at: 0,
    });

    render(<ProjectTopBarControls project={p} projectId={"p1" as ProjectId} networkId="n1" />);
    expect(screen.getByRole("button", { name: /^(Save|Enregistrer)/ })).toBeDisabled();
  });
});
