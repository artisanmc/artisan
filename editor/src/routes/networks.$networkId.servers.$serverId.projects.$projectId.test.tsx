import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "net_1", serverId: "sk_1", projectId: "p1" }),
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
      menus: [],
      commands: [],
      dialogs: [],
      assets: [],
    },
    networkId: "net_1",
  }),
}));
vi.mock("@/lib/api/userProjects", () => ({ getNetworkOfProject: vi.fn().mockResolvedValue("net_1") }));
vi.mock("@/components/ProjectTopBarControls", () => ({
  ProjectTopBarControls: () => <div data-testid="topbar" />,
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/sync/DeleteProjectDialog", () => ({ DeleteProjectDialog: () => null }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <>{children}</>,
  DragOverlay: () => null,
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  MouseSensor: class {},
  TouchSensor: class {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => true }));

import { ServerProjectPage } from "./networks.$networkId.servers.$serverId.projects.$projectId";

describe("ServerProjectPage", () => {
  it("renders the top bar for the loaded project", () => {
    render(<ServerProjectPage />);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });
});
