import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/state/authStore";

// Regression test for the dot-nesting bug: admin.ai.usage.tsx / admin.ai.usage.logs.tsx
// used to be file-route CHILDREN of admin.ai.tsx, which renders <AiModelsPage/> with no
// <Outlet/> — so /admin/ai/usage and /admin/ai/usage/logs never rendered their own page.
// Un-nested via the trailing-underscore convention (admin.ai_.usage(.logs).tsx) so they
// render as siblings under the /admin layout, which DOES have an <Outlet/> (admin.tsx).
// This is router-tree-shaped, so a smoke test on the real router is the only thing that
// would have caught it — a unit test on AiUsagePage/AiModelsPage in isolation can't.

const ADMIN_USER = { id: "u1", email: "admin@artisanmc.net", name: "Admin", avatarUrl: null, isAdmin: true };

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), capture: vi.fn(), identify: vi.fn() },
}));
vi.mock("@posthog/react", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/api/auth", () => ({
  getMe: vi.fn(async () => ADMIN_USER),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  patchMe: vi.fn(),
}));
vi.mock("@/lib/api/adminAiUsage", () => ({
  getUsageSummary: vi.fn(async () => ({
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      creditsCharged: 0,
      realCostMicroUsd: 0,
      marginMicroUsd: 0,
      turns: 0,
      errors: 0,
    },
    byModel: [],
    byProvider: [],
    daily: [],
  })),
  getUsageLogs: vi.fn(async () => ({ logs: [], nextCursor: null })),
  usageLogsCsvUrl: vi.fn(() => "http://backend/csv"),
}));

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  render(<RouterProvider router={router} />);
}

describe("admin /ai/usage(/logs) routing", () => {
  afterEach(() => {
    useAuthStore.setState({ currentUser: null, isLoading: true, error: null });
  });

  it("renders the usage page (not the models page) at /admin/ai/usage", async () => {
    useAuthStore.setState({ currentUser: ADMIN_USER, isLoading: false, error: null });
    renderAt("/admin/ai/usage");

    expect(await screen.findByRole("heading", { name: "Consommation" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Modèles IA" })).not.toBeInTheDocument();
  });

  it("renders the logs page at /admin/ai/usage/logs", async () => {
    useAuthStore.setState({ currentUser: ADMIN_USER, isLoading: false, error: null });
    renderAt("/admin/ai/usage/logs");

    expect(await screen.findByRole("heading", { name: "Logs IA" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Modèles IA" })).not.toBeInTheDocument();
  });
});
