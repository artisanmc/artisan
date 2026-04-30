import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PackGrid } from "./PackGrid";

const renderWithRouter = () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: PackGrid,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
};

describe("<PackGrid />", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("renders a card per seed pack", async () => {
    renderWithRouter();
    expect(await screen.findByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Shop System")).toBeInTheDocument();
    expect(screen.getByText("Daily Quests")).toBeInTheDocument();
  });

  it("shows the New pack button", async () => {
    renderWithRouter();
    expect(await screen.findByText("+ New pack")).toBeInTheDocument();
  });
});
