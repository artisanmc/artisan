import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ workspaceId: "p1", elementId: "m1" }),
    useNavigate: () => vi.fn(),
    Navigate: ({ to, params, replace }: any) => (
      <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
    ),
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/userPacks", () => ({
  loadUserPack: vi.fn().mockResolvedValue({
    pack: { id: "p1", name: "P", hash: "" },
    networkId: "net_1",
    serverKeyId: "sk_1",
    files: {},
    editor: {},
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ElementFocusRedirect from "./workspace.$workspaceId.element.$elementId";

describe("Legacy ElementFocusRedirect", () => {
  it("shows loading state initially", () => {
    render(<ElementFocusRedirect />);
    expect(screen.getByText("redirect.redirecting")).toBeInTheDocument();
  });

  it("navigates to the new server-scoped element URL after data loads", async () => {
    render(<ElementFocusRedirect />);
    await waitFor(() =>
      expect(screen.getByTestId("navigate")).toHaveAttribute(
        "data-to",
        "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      ),
    );
  });
});
