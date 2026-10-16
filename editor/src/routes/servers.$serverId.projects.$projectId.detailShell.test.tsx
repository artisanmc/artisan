import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@/features/onboarding/editorTourRuntime", () => ({
  useEditorTourState: () => ({ open: false, step: 0, progress: null, busy: false }),
  mountEditorTour: () => () => {},
  editorTourController: { next: vi.fn(), back: vi.fn(), defer: vi.fn(), complete: vi.fn() },
}));

// Detail-view variant: useChildMatches returns a non-empty array and Outlet
// renders a marker, so we can assert the shell (topbar) persists AROUND the
// detail view instead of the page early-returning to a bare Outlet.
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ serverId: "sk_1", projectId: "p1" }),
    useNavigate: () => navigate,
    Navigate: () => null,
    Outlet: () => <div data-testid="outlet" />,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: (_path: string) => (opts: any) => {
      const route = { ...opts };
      route.useSearch = () => ({ tab: "overview" });
      return route;
    },
    useChildMatches: () => [{}],
    useSearch: () => ({ tab: "overview" }),
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
vi.mock("@/features/project/useProjectLoader", () => ({
  useProjectLoader: () => ({
    // `failed` : Documents que le serveur n'a pas pu charger (ADR
    // server-disk-only-storage ③). Aucun ici.
    failed: [],
    project: {
      id: "p1",
      name: "Hub",
      defaultLang: "en",
      i18nKeys: {},
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
    },
  }),
}));
vi.mock("@/features/project/ProjectTopBarControls", () => ({
  ProjectTopBarControls: () => <div data-testid="topbar" />,
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
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

import { ServerProjectPage } from "./servers.$serverId.projects.$projectId";

describe("ServerProjectPage — detail view shell", () => {
  it("nests the detail view (Outlet) inside the persistent shell (topbar)", () => {
    render(<ServerProjectPage />);
    // Both must be present: the page did NOT early-return to a bare Outlet.
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    // The board (Stage) must NOT render in detail view — mutual exclusivity.
    expect(screen.queryByTestId("stage")).not.toBeInTheDocument();
  });
});
