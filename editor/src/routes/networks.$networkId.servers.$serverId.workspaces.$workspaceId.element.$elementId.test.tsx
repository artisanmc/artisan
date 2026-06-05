import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({
      networkId: "net_1",
      serverId: "sk_1",
      workspaceId: "p1",
      elementId: "m1",
    }),
    useNavigate: () => navigate,
    Navigate: () => null,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) =>
    sel({
      account: {
        packs: [
          {
            id: "p1",
            name: "P",
            defaultLang: "en",
            i18nKeys: {},
            menus: [{ id: "m1", title: [], rows: 3, slots: [], permission: null }],
            commands: [],
            dialogs: [],
            assets: [],
          },
        ],
      },
    }),
}));
vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: any) => sel({ accessToken: "tok" }),
}));
vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: any) => sel({ currentUser: null }),
}));
vi.mock("@/features/pack/usePackLoader", () => ({
  usePackLoader: () => ({ pack: null }),
}));
vi.mock("@/components/WorkspaceTopBarControls", () => ({
  WorkspaceTopBarControls: () => <div data-testid="top-bar" />,
}));
vi.mock("@/features/element-editor/ElementEditor", () => ({
  ElementEditor: () => <div data-testid="element-editor" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ServerElementFocusPage from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId";

describe("ServerElementFocusPage — Escape key handler", () => {
  beforeEach(() => navigate.mockClear());

  it("navigates back to canvas on Escape", () => {
    render(<ServerElementFocusPage />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
      params: { networkId: "net_1", serverId: "sk_1", workspaceId: "p1" },
    });
  });

  it("does NOT navigate when Escape is pressed inside an INPUT", () => {
    render(<ServerElementFocusPage />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
