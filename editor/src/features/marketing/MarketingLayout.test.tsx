import { RootLayout } from "@/routes/__root";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/pricing" }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouterState: () => route.pathname,
  Outlet: () => <div>Public page content</div>,
}));
vi.mock("@/components/NavigationSidebar", () => ({
  NavigationSidebar: () => <aside>Workspace navigation</aside>,
}));
vi.mock("@/components/ProjectSidebar", () => ({ ProjectSidebar: () => null }));
vi.mock("@/components/AdminSidebar", () => ({ AdminSidebar: () => null }));
vi.mock("@/features/demo/DemoAuthReturn", () => ({ DemoAuthReturn: () => null }));
vi.mock("@/features/project/useDraftSync", () => ({ useDraftSync: () => {} }));
vi.mock("@/components/BackendUnreachable", () => ({
  BackendUnreachable: () => <div>Backend unavailable</div>,
}));
const hydrate = useAuthStore.getState().hydrate;
beforeEach(() => {
  useAuthStore.setState({
    currentUser: null,
    sessionStatus: "unknown",
    backendUnreachable: true,
    hydrate: vi.fn(),
  });
  useNetworksStore.setState({ activeId: null });
  useServersStore.setState({ activeServerId: null });
});
afterEach(() => useAuthStore.setState({ hydrate }));

test.each(["/", "/pricing"])("keeps %s available during an API outage", (pathname) => {
  route.pathname = pathname;
  render(<RootLayout />);
  expect(screen.getByText("Public page content")).toBeVisible();
  expect(screen.queryByText("Backend unavailable")).not.toBeInTheDocument();
});
test("hides the workspace sidebar for a signed-in visitor on pricing", () => {
  route.pathname = "/pricing";
  useAuthStore.setState({ currentUser: { id: "u1" } } as never);
  render(<RootLayout />);
  expect(screen.queryByText("Workspace navigation")).not.toBeInTheDocument();
});
test("retains outage handling on private workspace routes", () => {
  route.pathname = "/networks";
  render(<RootLayout />);
  expect(screen.getByText("Backend unavailable")).toBeVisible();
});
