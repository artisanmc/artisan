import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DemoWorkspace } from "./DemoWorkspace";
import { bootstrapDemo } from "./demoLifecycle";

const route = vi.hoisted(() => ({ projectId: "demo" }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => route, useNavigate: () => vi.fn() }));
vi.mock("./demoLifecycle", () => ({
  bootstrapDemo: vi.fn(),
  getPendingDemoClaim: () => null,
  DEMO_AUTH_RETURN: "artisan:demo-auth-return",
}));
vi.mock("@/features/project/ProjectWorkspace", () => ({
  ProjectCanvasPage: ({ projectRef }: { projectRef: string }) => (
    <div data-testid="workspace">{projectRef}</div>
  ),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  vi.clearAllMocks();
  route.projectId = "demo";
  useAuthStore.setState({ currentUser: null, isLoading: false });
  useDemoStore.setState({ session: null, expired: false, active: false });
  sessionStorage.clear();
});

it("reloads the canonical demo URL using the current guest cookie's internal project", async () => {
  vi.mocked(bootstrapDemo).mockResolvedValue({
    projectId: "guest-stable",
    principal: { kind: "guest", id: "guest" },
    csrfToken: "csrf",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  render(<DemoWorkspace />);
  expect(await screen.findByTestId("workspace")).toHaveTextContent("guest-stable");
  expect(bootstrapDemo).toHaveBeenCalledWith(false);
});

it("shows an unavailable demo when the cookie cannot resolve it", async () => {
  vi.mocked(bootstrapDemo).mockResolvedValue(null);
  render(<DemoWorkspace />);
  expect(await screen.findByText("demo.unavailable")).toBeInTheDocument();
});

it("does not open another session's old URL", async () => {
  route.projectId = "old-other-session";
  vi.mocked(bootstrapDemo).mockResolvedValue({
    projectId: "guest-stable",
    principal: { kind: "guest", id: "guest" },
    csrfToken: "csrf",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  render(<DemoWorkspace />);
  expect(await screen.findByText("demo.unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("workspace")).toBeNull();
});
