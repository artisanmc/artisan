import * as diskSave from "@/features/project/saveProjectToDisk";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

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

describe("ProjectTopBarControls", () => {
  it("shows the actual editor and server contents before choosing a conflict resolution", async () => {
    const previousAccount = useAccountStore.getState().account;
    const previousUser = useAuthStore.getState().currentUser;
    const account = mockAccount();
    const project = account.projects[0]!;
    const mine = diskSave.projectTree(project)["manifest.yaml"]!;
    const save = vi.spyOn(diskSave, "saveProjectToDisk").mockResolvedValue({
      ok: false,
      error: "conflict",
      conflicts: [{ path: "manifest.yaml", disk: "name: Remote shop\n" }],
      diskFiles: ["manifest.yaml"],
    });
    try {
      useAccountStore.setState({ account });
      useAuthStore.setState({
        currentUser: { id: "diff-user", email: "diff@example.test", name: "Diff", avatarUrl: null },
      });
      useProjectDraftStore
        .getState()
        .save(project.id, { baseline: {}, tree: { "manifest.yaml": mine }, at: 1 });
      render(<ProjectTopBarControls project={project} projectId={project.id} />);
      fireEvent.click(screen.getByRole("button", { name: /^(Save|Enregistrer)/ }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("name: Remote shop")).toBeInTheDocument();
      expect(within(dialog).getByRole("region")).toHaveTextContent(mine.split("\n")[0]!);
      expect(within(dialog).getByRole("button", { name: /^(Apply|Appliquer)$/ })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole("button", { name: /Keep mine|Garder ma version/ }));
      expect(within(dialog).getByRole("button", { name: /^(Apply|Appliquer)$/ })).toBeEnabled();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      save.mockRestore();
      act(() => {
        useAccountStore.setState({ account: previousAccount });
        useAuthStore.setState({ currentUser: previousUser });
        useProjectDraftStore.getState().clear(project.id);
      });
    }
  });
  it("updates the header when the project display name changes", () => {
    const project = {
      id: "named_project",
      name: "named_project",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    const previous = useAccountStore.getState().account;
    try {
      useAccountStore.setState({ account: { ...previous, projects: [project] } });
      render(
        <ProjectTopBarControls
          project={project}
          projectId={project.id}
          projectName={project.name}
        />,
      );
      act(() =>
        useAccountStore.setState({
          account: { ...previous, projects: [{ ...project, name: "Mon atelier" }] },
        }),
      );
      expect(
        within(screen.getByTestId("project-header")).getByText("Mon atelier"),
      ).toBeInTheDocument();
      expect(within(screen.getByTestId("project-header")).queryByText("named_project")).toBeNull();
    } finally {
      act(() => useAccountStore.setState({ account: previous }));
    }
  });
  it("separates project actions, navigation and canvas tools", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(within(screen.getByTestId("project-header")).getByText("Test")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-header")).getByRole("button", {
        name: /^(Save|Enregistrer)/,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-view-navigation")).getByTestId("open-view-overview"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-editing-tools")).getByTitle(/Undo \(|Annuler \(/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("open-view-overview").querySelector("kbd")).toBeNull();
  });
  it("renders the lang switcher, undo/redo, and save when a project is provided", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    // Make assertions broad — we just want to confirm the trio is in the DOM.
    // Titles may be in English or French depending on test locale.
    const undoMatches = screen.getAllByTitle(/Undo \(|Annuler \(/i);
    expect(undoMatches.length).toBeGreaterThanOrEqual(1);
    // Un seul geste depuis la bascule « disque seul » : Enregistrer a remplacé
    // la paire Déployer / Revenir (ADR `server-disk-only-storage`).
    expect(screen.getByRole("button", { name: /^(Save|Enregistrer)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Deploy|Déployer)/ })).toBeNull();
  });

  it("renders the workspace view buttons with a missing-translations badge", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "fr",
      // activeLang defaults to the browser lang in tests ("en") — count misses
      // for en: k1 has French source text but no English value → 1 missing.
      i18nKeys: { k1: { fr: "Bonjour" }, k2: { fr: "Au revoir", en: "Bye" } },
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(screen.getByTestId("open-view-translations")).toBeInTheDocument();
    expect(screen.getByTestId("open-view-data-sources")).toBeInTheDocument();
    expect(screen.getByTestId("open-view-translations")).toHaveTextContent("1");
  });
});
