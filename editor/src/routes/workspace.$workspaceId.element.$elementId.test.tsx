import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ElementFocusPage from "./workspace.$workspaceId.element.$elementId";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ workspaceId: "p1", elementId: "m1" }),
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

// Mock heavy sub-components to avoid their own deep dependency trees.
vi.mock("@/components/WorkspaceTopBarControls", () => ({
  WorkspaceTopBarControls: () => <div data-testid="top-bar" />,
}));
vi.mock("@/features/element-editor/ElementEditor", () => ({
  ElementEditor: () => <div data-testid="element-editor" />,
}));

// react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("ElementFocusPage — Escape key handler", () => {
  beforeEach(() => navigate.mockClear());

  it("navigates back to canvas on Escape", () => {
    render(<ElementFocusPage />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith({
      to: "/workspace/$workspaceId",
      params: { workspaceId: "p1" },
    });
  });

  it("does NOT navigate when Escape is pressed inside an INPUT", () => {
    render(<ElementFocusPage />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
