import { resolveDraftConflict, usePersistedDraftStore } from "@/features/project/persistedDrafts";
import * as diskSave from "@/features/project/saveProjectToDisk";
import { mockOpenProjects } from "@/mock/fixtures";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectTopBarControls } from "./ProjectTopBarControls";

vi.mock("@/features/project/persistedDrafts", async () => {
  const actual = await vi.importActual<typeof import("@/features/project/persistedDrafts")>(
    "@/features/project/persistedDrafts",
  );
  return { ...actual, resolveDraftConflict: vi.fn(async () => {}) };
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

describe("ProjectTopBarControls", () => {
  it("shows the actual editor and server contents before choosing a conflict resolution", async () => {
    const previousProjects = useProjectsStore.getState().openProjects;
    const previousUser = useAuthStore.getState().currentUser;
    const openProjects = mockOpenProjects();
    const project = openProjects.projects[0]!;
    const mine = diskSave.projectTree(project)["artisan-module.yml"]!;
    const save = vi.spyOn(diskSave, "saveProjectToDisk").mockResolvedValue({
      ok: false,
      error: "conflict",
      conflicts: [{ path: "artisan-module.yml", disk: "name: Remote shop\n" }],
      diskFiles: ["artisan-module.yml"],
    });
    try {
      useProjectsStore.setState({ openProjects });
      useAuthStore.setState({
        currentUser: { id: "diff-user", email: "diff@example.test", name: "Diff", avatarUrl: null },
      });
      useProjectDraftStore
        .getState()
        .save(project.id, { baseline: {}, tree: { "artisan-module.yml": mine }, at: 1 });
      render(<ProjectTopBarControls project={project} projectId={project.id} />);
      fireEvent.click(screen.getByRole("button", { name: /^(Deploy|Déployer)/ }));
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: /Deploy to the server|Déployer sur le serveur/,
        }),
      );
      await waitFor(() => expect(save).toHaveBeenCalled());
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
        useProjectsStore.setState({ openProjects: previousProjects });
        useAuthStore.setState({ currentUser: previousUser });
        useProjectDraftStore.getState().clear(project.id);
      });
    }
  });
  it("opens the conflicts found when the draft opens, and applying them publishes nothing", async () => {
    const previousProjects = useProjectsStore.getState().openProjects;
    const previousUser = useAuthStore.getState().currentUser;
    const openProjects = mockOpenProjects();
    const project = openProjects.projects[0]!;
    const mine = diskSave.projectTree(project)["artisan-module.yml"]!;
    const save = vi.spyOn(diskSave, "saveProjectToDisk");
    try {
      useProjectsStore.setState({ openProjects });
      useAuthStore.setState({
        currentUser: { id: "open-user", email: "open@example.test", name: "Open", avatarUrl: null },
      });
      useProjectBaselineStore.getState().set(project.id, { "artisan-module.yml": "name: Base\n" });
      useProjectDraftStore.getState().save(project.id, {
        baseline: { "artisan-module.yml": "name: Base\n" },
        tree: { "artisan-module.yml": mine },
        at: 1,
      });
      usePersistedDraftStore.setState({
        sessions: {
          [project.id]: {
            ownerId: "open-user",
            drafts: [],
            status: "saved",
            openConflicts: [{ path: "artisan-module.yml", disk: "name: Remote shop\n" }],
          },
        },
      });
      render(<ProjectTopBarControls project={project} projectId={project.id} />);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("name: Remote shop")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /Keep mine|Garder ma version/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: /^(Apply|Appliquer)$/ }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(save).not.toHaveBeenCalled();
      expect(useProjectDraftStore.getState().get(project.id)?.baseline).toEqual({
        "artisan-module.yml": "name: Remote shop\n",
      });
      expect(usePersistedDraftStore.getState().sessions[project.id]?.openConflicts).toBeUndefined();
    } finally {
      save.mockRestore();
      act(() => {
        useProjectsStore.setState({ openProjects: previousProjects });
        useAuthStore.setState({ currentUser: previousUser });
        useProjectDraftStore.getState().clear(project.id);
        usePersistedDraftStore.setState({ sessions: {} });
      });
    }
  });
  it("updates the header when the project display name changes", () => {
    const project = {
      id: "named_project",
      name: "named_project",
      defaultLang: "en",
      i18nKeys: {},
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
    } as any;
    const previous = useProjectsStore.getState().openProjects;
    try {
      useProjectsStore.setState({ openProjects: { ...previous, projects: [project] } });
      render(
        <ProjectTopBarControls
          project={project}
          projectId={project.id}
          projectName={project.name}
        />,
      );
      act(() =>
        useProjectsStore.setState({
          openProjects: { ...previous, projects: [{ ...project, name: "Mon atelier" }] },
        }),
      );
      expect(
        within(screen.getByTestId("project-header")).getByText("Mon atelier"),
      ).toBeInTheDocument();
      expect(within(screen.getByTestId("project-header")).queryByText("named_project")).toBeNull();
    } finally {
      act(() => useProjectsStore.setState({ openProjects: previous }));
    }
  });
  it("separates project actions, navigation and canvas tools", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "en",
      i18nKeys: {},
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(within(screen.getByTestId("project-header")).getByText("Test")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("project-header")).getByRole("button", {
        name: /^(Deploy|Déployer)/,
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
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    // Broad assertions — we just want to confirm the trio is in the DOM.
    // Titles may be in English or French depending on test locale.
    const undoMatches = screen.getAllByTitle(/Undo \(|Annuler \(/i);
    expect(undoMatches.length).toBeGreaterThanOrEqual(1);
    // Deploy writes to the server; Save (player draft) only exists with a
    // drafts session.
    expect(screen.getByRole("button", { name: /^(Deploy|Déployer)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Save|Enregistrer)$/ })).toBeNull();
  });

  it("renders the workspace view buttons with a missing-translations badge", () => {
    const project = {
      id: "p1",
      name: "Test",
      defaultLang: "fr",
      // activeLang defaults to the browser lang in tests ("en") — count misses
      // for en: k1 has French source text but no English value → 1 missing.
      i18nKeys: { k1: { fr: "Bonjour" }, k2: { fr: "Au revoir", en: "Bye" } },
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
    } as any;
    render(<ProjectTopBarControls project={project} projectId={"p1" as any} />);
    expect(screen.getByTestId("open-view-translations")).toBeInTheDocument();
    // The project's data live in the sidebar, the server's sources on the server page.
    expect(screen.queryByTestId("open-view-data-sources")).toBeNull();
    expect(screen.getByTestId("open-view-resources")).toHaveAccessibleName(/resources|ressources/i);
    expect(screen.getByTestId("open-view-translations")).toHaveTextContent("1");
  });

  it("opens the per-file modal when another session advanced the draft, and applies the choice", async () => {
    const previousProjects = useProjectsStore.getState().openProjects;
    const previousUser = useAuthStore.getState().currentUser;
    const openProjects = mockOpenProjects();
    const project = openProjects.projects[0]!;
    const mine = diskSave.projectTree(project)["artisan-module.yml"]!;
    try {
      useProjectsStore.setState({ openProjects });
      useAuthStore.setState({
        currentUser: { id: "u1", email: "draft@example.test", name: "Draft", avatarUrl: null },
      });
      useProjectDraftStore.getState().save(project.id, {
        baseline: { "artisan-module.yml": "base" },
        tree: { "artisan-module.yml": mine },
        initialTree: { "artisan-module.yml": "base" },
        at: 1,
      });
      usePersistedDraftStore.setState({
        sessions: {
          [project.id]: {
            ownerId: "u1",
            drafts: [],
            status: "conflict",
            draftConflict: {
              remote: {
                id: "d1",
                projectId: project.id,
                ownerId: "u1",
                name: "Other",
                revision: 2,
                status: "active",
                snapshot: {
                  baseline: { "artisan-module.yml": "base" },
                  tree: { "artisan-module.yml": "name: Other\n" },
                  initialTree: { "artisan-module.yml": "base" },
                  at: 2,
                },
                source: "editor",
                updatedAt: "today",
              },
              merged: {
                baseline: { "artisan-module.yml": "base" },
                tree: { "artisan-module.yml": mine },
              },
              conflicts: [{ path: "artisan-module.yml", disk: "name: Other\n" }],
            },
          },
        },
      });
      render(<ProjectTopBarControls project={project} projectId={project.id} />);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("name: Other")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /Keep mine|Garder ma version/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: /^(Apply|Appliquer)$/ }));
      await waitFor(() =>
        expect(resolveDraftConflict).toHaveBeenCalledWith(project.id, {
          "artisan-module.yml": "mine",
        }),
      );
    } finally {
      act(() => {
        useProjectsStore.setState({ openProjects: previousProjects });
        useAuthStore.setState({ currentUser: previousUser });
        useProjectDraftStore.getState().clear(project.id);
        usePersistedDraftStore.setState({ sessions: {} });
      });
    }
  });
});
