import type { ProjectId } from "@/domain/types";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();

vi.mock("@/features/onboarding/editorTourRuntime", () => ({
  useEditorTourState: () => ({ open: false, step: 0, progress: null, busy: false }),
  mountEditorTour: () => () => {},
  editorTourController: { next: vi.fn(), back: vi.fn(), defer: vi.fn(), complete: vi.fn() },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({
      serverId: "sk_1",
      projectId: "p1",
      documentId: loaderState.documentId,
    }),
    useNavigate: () => navigate,
    Navigate: () => null,
    Outlet: () => null,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: (_path: string) => (opts: any) => {
      const route = { ...opts };
      route.useSearch = () => ({ tab: "overview" });
      return route;
    },
    useChildMatches: () => [],
    useSearch: () => ({ tab: loaderState.tab }),
  };
});

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: any) => sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) =>
    sel({
      account: { projects: [], projectOrder: [] },
      importProject: vi.fn(),
      reorderProjects: vi.fn(),
      setAppearanceField: vi.fn(),
    }),
}));
const loaderState = vi.hoisted(() => ({
  loaded: true,
  tab: "overview",
  diskId: undefined as string | undefined,
  documentId: undefined as string | undefined,
}));
vi.mock("@/features/project/useProjectLoader", () => ({
  useProjectLoader: () =>
    loaderState.loaded ? loadedProject() : { failed: [], project: null, networkId: "net_1" },
}));
function loadedProject() {
  return {
    // `failed` : Documents que le serveur n'a pas pu charger (ADR
    // server-disk-only-storage ③). Aucun ici.
    failed: [],
    project: {
      id: "p1",
      diskId: loaderState.diskId,
      name: "Hub",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    },
    networkId: "net_1",
  };
}
vi.mock("@/lib/api/userProjects", () => ({
  getNetworkOfProject: vi.fn().mockResolvedValue("net_1"),
}));
vi.mock("@/components/ProjectTopBarControls", () => ({
  ProjectTopBarControls: () => <div data-testid="topbar" />,
}));
vi.mock("@/features/assets/AssetsTab", () => ({
  AssetsTab: () => <div data-testid="resources-manager" />,
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/sync/DeleteProjectDialog", () => ({ DeleteProjectDialog: () => null }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <>{children}</>,
  DragOverlay: () => null,
  useDndContext: () => ({ active: null }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  MouseSensor: class {},
  TouchSensor: class {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));

import { validateProjectSearch } from "@/features/project/ProjectWorkspace";
import { useProjectLibraryStore } from "@/features/project/projectLibraryStore";
import { useUiStore } from "@/state/uiStore";
import { ServerProjectPage } from "./servers.$serverId.projects.$projectId";

describe("ServerProjectPage", () => {
  beforeEach(() => {
    loaderState.loaded = true;
    loaderState.tab = "overview";
    loaderState.diskId = undefined;
    loaderState.documentId = undefined;
    navigate.mockClear();
  });

  it("renders the top bar for the loaded project", () => {
    render(<ServerProjectPage />);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });

  it("replaces a legacy URL with the module ID while retaining document, search and fragment", () => {
    loaderState.diskId = "boutique_addon";
    loaderState.documentId = "menu";
    render(<ServerProjectPage />);
    const destination = navigate.mock.calls[0]![0];
    expect(destination).toMatchObject({
      to: "/servers/$serverId/projects/$projectId/document/$documentId",
      params: {
        serverId: "sk_1",
        projectId: "boutique_addon",
        documentId: "menu",
      },
      replace: true,
      hash: true,
    });
    expect(destination.search({ tab: "translations" })).toEqual({ tab: "translations" });
  });

  /**
   * A Project's content is read from ITS server's disk: it takes as long as it
   * takes. Rendering nothing meanwhile (`return null`) gave a blank page for
   * several seconds, which looks like an outage.
   */
  it("announces the read instead of leaving a blank page", () => {
    loaderState.loaded = false;
    render(<ServerProjectPage />);
    expect(screen.getByText("project.loading")).toBeInTheDocument();
    // A skeleton shaped like the screen, not a spinner in the void: the layout
    // must not jump when the data arrives.
    expect(screen.getByTestId("project-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("topbar")).not.toBeInTheDocument();
  });
});

it("retains Resources in the shared demo, hosted and live route search validator", () => {
  expect(validateProjectSearch({ tab: "resources" })).toEqual({ tab: "resources" });
  expect(validateProjectSearch({ tab: "unknown" })).toEqual({ tab: "overview" });
});
it("opens Resources in the center without buttons or inspector and retains the canvas", () => {
  loaderState.loaded = true;
  loaderState.diskId = undefined;
  loaderState.documentId = undefined;
  loaderState.tab = "resources";
  useProjectLibraryStore.getState().open("p1" as ProjectId);
  useUiStore.setState({ projectSettingsOpen: true });
  try {
    render(<ServerProjectPage />);
    expect(screen.getByRole("tabpanel", { name: "project.tabs.resources" })).toBeInTheDocument();
    expect(screen.getByTestId("resources-manager")).toBeInTheDocument();
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "projectLibrary.title" })).toBeNull();
    expect(screen.queryByTestId("editor-pane")).toBeNull();
    expect(useUiStore.getState().lastActiveTab).toBe("resources");
  } finally {
    useUiStore.setState({ projectSettingsOpen: false });
    useProjectLibraryStore.getState().close();
  }
});
