import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { beforeEach, expect, test, vi } from "vitest";
import { projectPrincipal } from "./projectPrincipal";
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));

const session = {
  principal: { kind: "guest" as const, id: "guest-owner" },
  projectId: "demo-project",
  expiresAt: "2026-09-14T12:00:00Z",
  csrfToken: "opaque-csrf",
};
beforeEach(() => {
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession(null);
});
test("guest editing keeps its principal through sign-in until ownership is claimed", () => {
  useDemoStore.getState().setSession(session);
  useDemoStore.getState().setActive(true);
  expect(projectPrincipal.current("demo-project")).toEqual(session.principal);
  useAuthStore.setState({ currentUser: { id: "account-owner" } } as never);
  expect(projectPrincipal.current("demo-project")).toEqual(session.principal);
  expect(projectPrincipal.current("other-project")).toEqual({
    kind: "account",
    id: "account-owner",
  });
  useDemoStore.getState().setSession(null);
  expect(projectPrincipal.current("demo-project")).toEqual({
    kind: "account",
    id: "account-owner",
  });
});
test("an expired matching guest never falls back to the signed-in account", () => {
  useDemoStore.getState().setSession(session);
  useAuthStore.setState({ currentUser: { id: "account-owner" } } as never);
  useDemoStore.getState().expire();
  expect(projectPrincipal.current("demo-project")).toBeNull();
  expect(projectPrincipal.current("other-project")?.id).toBe("account-owner");
});
