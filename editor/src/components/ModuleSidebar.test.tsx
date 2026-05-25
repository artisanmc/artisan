import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter, createRootRoute, Outlet } from "@tanstack/react-router";
import { ModuleSidebar } from "./ModuleSidebar";
import { registerModule, clearRegistry } from "../modules/api/registry";

function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}<Outlet /></> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("ModuleSidebar", () => {
  beforeEach(() => clearRegistry());

  it("renders one entry per registered module", async () => {
    registerModule({
      id: "a", displayName: "Alpha", schemaVersion: "a/v1",
      sidebar: { icon: () => null, label: "Alpha", to: "/" }, routes: [],
    });
    registerModule({
      id: "b", displayName: "Beta", schemaVersion: "b/v1",
      sidebar: { icon: () => null, label: "Beta", to: "/" }, routes: [],
    });
    renderInRouter(<ModuleSidebar />);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
