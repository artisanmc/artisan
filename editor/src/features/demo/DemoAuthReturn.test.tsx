import { useAuthStore } from "@/state/authStore";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DemoAuthReturn } from "./DemoAuthReturn";
const navigate = vi.fn();
const route = vi.hoisted(() => ({ pathname: "/account" }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: () => route.pathname,
}));
vi.mock("./demoLifecycle", () => ({ DEMO_AUTH_RETURN: "artisan:demo-auth-return" }));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));
beforeEach(() => {
  navigate.mockClear();
  sessionStorage.clear();
  route.pathname = "/account";
});
test.each(["/", "/pricing", "/credits"])(
  "preserves an explicit destination %s despite a pending demo",
  (pathname) => {
    route.pathname = pathname;
    sessionStorage.setItem("artisan:demo-auth-return", "/demo/projects/immutable");
    useAuthStore.setState({ currentUser: { id: "owner" } } as never);
    render(<DemoAuthReturn />);
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("artisan:demo-auth-return")).toBe("/demo/projects/immutable");
  },
);
test("OAuth account landing returns to the pending demo", async () => {
  sessionStorage.setItem("artisan:demo-auth-return", "/demo/projects/immutable");
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  render(<DemoAuthReturn />);
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/demo/projects/$projectId",
      params: { projectId: "immutable" },
    }),
  );
});
test("failed login retains the return intent without navigating", () => {
  useAuthStore.setState({ currentUser: null });
  sessionStorage.setItem("artisan:demo-auth-return", "/demo/projects/immutable");
  render(<DemoAuthReturn />);
  expect(navigate).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("artisan:demo-auth-return")).toBe("/demo/projects/immutable");
});
