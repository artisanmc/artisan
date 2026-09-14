import type { Project, ProjectId } from "@/domain/types";
import { saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

vi.mock("@/features/project/saveProjectToDisk", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/saveProjectToDisk")>(
    "@/features/project/saveProjectToDisk",
  );
  return { ...actual, saveProjectToDisk: vi.fn(async () => ({ ok: true, wrote: 1 })) };
});

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => () => {},
    useParams: () => ({}),
    useSearch: () => ({ tab: "overview" }),
  };
});

function baseProject(name: string): Project {
  return {
    id: "p1" as ProjectId,
    diskId: "p1",
    name,
    source: "user_created",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    defaultLang: "en",
    i18nKeys: {},
    menus: [],
    commands: [],
    dialogs: [],
    assets: [],
    dataSources: [],
    canvasLayout: {},
    serverKeyId: "sk1",
  };
}

/**
 * Régression : le bouton Enregistrer sérialisait la prop `project`, qui vient
 * d'un `useState` figé au chargement (`useProjectLoader`). Toutes les éditions
 * vivent dans `useAccountStore` — enregistrer écrivait donc le Project tel
 * qu'il était à l'OUVERTURE, et perdait silencieusement tout le travail de la
 * session. Constaté en jeu le 2026-08-13 (un élément ajouté n'apparaissait pas).
 */
describe("ProjectTopBarControls — Enregistrer", () => {
  it("explains how to recover a conflicting backend draft", async () => {
    const p = baseProject("Boutique");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    useProjectDraftStore.getState().save("p1", {
      baseline: {},
      initialTree: {},
      tree: { "manifest.yaml": "changed" },
      at: 0,
    });
    vi.mocked(saveProjectToDisk).mockResolvedValueOnce({
      ok: false,
      error: "write_error",
      code: "draft_conflict",
      status: 409,
    });
    render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
    fireEvent.click(screen.getByRole("button", { name: /^(Save|Enregistrer)/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Créer une copie|Create a copy/);
  });
  it("shows, copies and reopens the last save failure", async () => {
    const user = userEvent.setup();
    const p = baseProject("edited");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    useProjectDraftStore.getState().save("p1", {
      baseline: {},
      initialTree: {},
      tree: { "manifest.yaml": "changed" },
      at: 0,
    });
    vi.mocked(saveProjectToDisk).mockResolvedValueOnce({
      ok: false,
      error: "write_error",
      status: 422,
      message: "AccessDeniedException: menus/shop.yaml",
    });
    render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
    await user.click(screen.getByRole("button", { name: /^(Save|Enregistrer)/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "AccessDeniedException: menus/shop.yaml",
    );
    await user.click(screen.getByRole("button", { name: /Copy details|Copier les détails/ }));
    expect(await navigator.clipboard.readText()).toContain(
      "AccessDeniedException: menus/shop.yaml",
    );
    expect(await navigator.clipboard.readText()).toContain("HTTP 422");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Save options|Options d’enregistrement/ }));
    await user.click(screen.getByRole("menuitem", { name: /Last save error|Dernière erreur/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "AccessDeniedException: menus/shop.yaml",
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^(Save|Enregistrer)/ }));
    await waitFor(() => expect(saveProjectToDisk).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: /Save options|Options d’enregistrement/ }));
    expect(
      screen.queryByRole("menuitem", { name: /Last save error|Dernière erreur/ }),
    ).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.mocked(saveProjectToDisk).mockReset();
    vi.mocked(saveProjectToDisk).mockResolvedValue({ ok: true, wrote: 1 });
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

    render(<ProjectTopBarControls project={stale} projectId={"p1" as ProjectId} networkId="n1" />);
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
