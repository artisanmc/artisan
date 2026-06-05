import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "net_1", serverId: "sk_1", workspaceId: "p1" }),
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

vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: any) =>
    sel({ accessToken: null, networkId: null, setAccessToken: vi.fn(), clearSession: vi.fn() }),
}));
vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: any) => sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) =>
    sel({
      account: { packs: [], packOrder: [] },
      importPack: vi.fn(),
      reorderPacks: vi.fn(),
      setAppearanceField: vi.fn(),
    }),
}));
vi.mock("@/features/pack/usePackLoader", () => ({
  usePackLoader: () => ({
    pack: {
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
vi.mock("@/lib/api/userPacks", () => ({ getNetworkOfPack: vi.fn().mockResolvedValue("net_1") }));
vi.mock("@/components/WorkspaceTopBarControls", () => ({
  WorkspaceTopBarControls: () => <div data-testid="topbar" />,
}));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({
  EditorPane: () => <div data-testid="editor-pane" />,
}));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/sync/DeletePackDialog", () => ({ DeletePackDialog: () => null }));
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

import { ServerWorkspacePage } from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId";

describe("ServerWorkspacePage", () => {
  it("renders the top bar for the loaded pack", () => {
    render(<ServerWorkspacePage />);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });
});
