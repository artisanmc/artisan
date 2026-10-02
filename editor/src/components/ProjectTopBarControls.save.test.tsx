import type { Project, ProjectId } from "@/domain/types";
import { syncPersistedDraft, usePersistedDraftStore } from "@/features/project/persistedDrafts";
import { saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

vi.mock("@/features/project/saveProjectToDisk", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/saveProjectToDisk")>(
    "@/features/project/saveProjectToDisk",
  );
  return { ...actual, saveProjectToDisk: vi.fn(async () => ({ ok: true, wrote: 1 })) };
});

vi.mock("@/features/project/persistedDrafts", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/persistedDrafts")>(
    "@/features/project/persistedDrafts",
  );
  return { ...actual, syncPersistedDraft: vi.fn(async () => {}) };
});

const DEPLOY = /^(Deploy|Déployer)/;
async function deployAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: DEPLOY }));
  const review = await screen.findByRole("dialog");
  fireEvent.click(
    within(review).getByRole("button", { name: /Deploy to the server|Déployer sur le serveur/ }),
  );
}

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => () => {},
    useParams: () => ({}),
    useSearch: () => ({ tab: "overview" }),
    Link: ({ children, to, params: _params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
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
    await deployAndConfirm();
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
    await deployAndConfirm();
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
    await deployAndConfirm();
    await waitFor(() => expect(saveProjectToDisk).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: /Save options|Options d’enregistrement/ }));
    expect(
      screen.queryByRole("menuitem", { name: /Last save error|Dernière erreur/ }),
    ).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.mocked(saveProjectToDisk).mockReset();
    vi.mocked(saveProjectToDisk).mockResolvedValue({ ok: true, wrote: 1 });
    vi.mocked(syncPersistedDraft).mockClear();
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
    await deployAndConfirm();

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
    expect(screen.getByRole("button", { name: DEPLOY })).toBeDisabled();
  });

  it("shows the changes before deploying and writes nothing when cancelled", async () => {
    const p = baseProject("revue");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    useProjectDraftStore.getState().save("p1", {
      baseline: {},
      initialTree: {},
      tree: { "manifest.yaml": "changed" },
      at: 0,
    });
    render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
    fireEvent.click(screen.getByRole("button", { name: DEPLOY }));
    const review = await screen.findByRole("dialog");
    expect(within(review).getByRole("button", { name: /manifest\.yaml/ })).toBeInTheDocument();
    expect(within(review).getAllByText(/New|Nouveau/).length).toBeGreaterThan(0);
    fireEvent.click(within(review).getByRole("button", { name: /^(Cancel|Annuler)$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveProjectToDisk).not.toHaveBeenCalled();
  });

  describe("contrôles entre projets dans la revue", () => {
    const command = (id: string, name: string) => ({
      id,
      projectId: "x",
      name,
      arguments: [],
      steps: [],
    });
    function openReviewWith(index: {
      scope: string;
      status: "loading" | "ready";
      projects: Project[];
      failed: string[];
    }) {
      const p = { ...baseProject("revue"), commands: [command("c1", "craft")] } as unknown as Project;
      useAccountStore.setState({
        account: { id: "n1", projects: [p], projectOrder: [p.id] },
      } as never);
      useProjectDraftStore.getState().save("p1", {
        baseline: {},
        initialTree: {},
        tree: { "manifest.yaml": "changed" },
        at: 0,
      });
      useServerIndexStore.setState(index);
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      fireEvent.click(screen.getByRole("button", { name: DEPLOY }));
    }

    it("warns about a command another project already claims, without blocking the deploy", async () => {
      const shop = {
        ...baseProject("Boutique"),
        id: "shop" as ProjectId,
        diskId: "shop",
        commands: [command("c2", "craft")],
      } as unknown as Project;
      openReviewWith({ scope: "n1/s1", status: "ready", projects: [shop], failed: [] });
      const review = await screen.findByRole("dialog");
      expect(review).toHaveTextContent(/\/craft .* p1:c1, shop:c2/);
      expect(
        within(review).getByRole("button", { name: /Deploy to the server|Déployer sur le serveur/ }),
      ).toBeEnabled();
    });

    it("does not pretend the checks passed while the other projects are loading", async () => {
      openReviewWith({ scope: "n1/s1", status: "loading", projects: [], failed: [] });
      const review = await screen.findByRole("dialog");
      expect(review).toHaveTextContent(/pas encore faits|not done yet/);
      expect(review).not.toHaveTextContent(/Aucun conflit|No conflict/);
    });
  });

  it("saves the draft to the account without deploying it", async () => {
    const p = baseProject("brouillon");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "pending" } },
    });
    try {
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      fireEvent.click(screen.getByRole("button", { name: /^(Save|Enregistrer)$/ }));
      await waitFor(() => expect(syncPersistedDraft).toHaveBeenCalledWith("p1"));
      expect(saveProjectToDisk).not.toHaveBeenCalled();
    } finally {
      usePersistedDraftStore.setState({ sessions: {} });
    }
  });

  it("shows Save as a disk icon with a tooltip, and Deploy with a play icon beside its label", () => {
    const p = baseProject("icônes");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "pending" } },
    });
    try {
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      const save = screen.getByRole("button", { name: /^(Save|Enregistrer)$/ });
      expect(save).toHaveTextContent(/^$/);
      expect(save).not.toHaveAttribute("title");
      expect(save.querySelector('svg[data-icon="save-filled"]')).not.toBeNull();
      const deploy = screen.getByRole("button", { name: DEPLOY });
      expect(deploy).toHaveTextContent(/Deploy|Déployer/);
      expect(deploy.querySelector("svg.lucide-play")).toHaveAttribute("fill", "currentColor");
    } finally {
      usePersistedDraftStore.setState({ sessions: {} });
    }
  });

  it.each([
    ["pending", /not saved to your account yet|pas encore enregistrées sur votre compte/],
    ["saved", /Draft saved to your account|Brouillon enregistré sur votre compte/],
    ["offline", /Local copy only|Copie locale seulement/],
    ["conflict", /another session|autre session/],
  ] as const)("explains the %s draft state in a tooltip", async (status, text) => {
    const p = baseProject("bulle");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    usePersistedDraftStore.setState({ sessions: { p1: { ownerId: "u1", drafts: [], status } } });
    try {
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      fireEvent.focus(
        screen.getByRole("button", { name: /^(Save|Saved|Enregistrer|Enregistré)$/ }),
      );
      expect(await screen.findByRole("tooltip")).toHaveTextContent(text);
    } finally {
      usePersistedDraftStore.setState({ sessions: {} });
    }
  });

  it("spins the save icon while the draft is being saved", () => {
    const p = baseProject("en cours");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saving" } },
    });
    try {
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      const save = screen.getByRole("button", { name: /^(Saving…|Enregistrement…)$/ });
      expect(save).toHaveAttribute("aria-disabled", "true");
      expect(save.querySelector(".animate-spin")).not.toBeNull();
    } finally {
      usePersistedDraftStore.setState({ sessions: {} });
    }
  });

  it("marks the draft as saved once the account holds it", () => {
    const p = baseProject("à jour");
    useAccountStore.setState({
      account: { id: "n1", projects: [p], projectOrder: [p.id] },
    } as never);
    usePersistedDraftStore.setState({
      sessions: { p1: { ownerId: "u1", drafts: [], status: "saved" } },
    });
    try {
      render(<ProjectTopBarControls project={p} projectId={p.id} networkId="n1" />);
      const save = screen.getByRole("button", { name: /^(Saved|Enregistré)$/ });
      expect(save).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(save);
      expect(syncPersistedDraft).not.toHaveBeenCalled();
    } finally {
      usePersistedDraftStore.setState({ sessions: {} });
    }
  });
});
