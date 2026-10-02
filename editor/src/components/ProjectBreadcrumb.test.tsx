import * as networksApi from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: { children?: React.ReactNode; to?: string; params?: unknown }) => (
    <a href={`${to}|${JSON.stringify(params)}`} {...props}>
      {children}
    </a>
  ),
}));

import { ProjectBreadcrumb } from "./ProjectBreadcrumb";

beforeEach(() => {
  vi.restoreAllMocks();
  useNetworksStore.setState({
    networks: [{ id: "net_1", slug: "primalcraft", name: "Primalcraft", tier: "free" }],
  } as never);
  vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
    network: { id: "net_1", name: "Primalcraft", tier: "free" },
    projects: [],
    serverKeys: [{ id: "sk_1", slug: "survie", label: "Survie" }],
  } as never);
});

it("links the network and the server, and ends on the project", async () => {
  render(<ProjectBreadcrumb networkRef="primalcraft" serverRef="survie" projectName="main" />);
  const network = screen.getByRole("link", { name: "Primalcraft" });
  expect(network.getAttribute("href")).toContain("/networks/$networkId|");
  const server = await screen.findByRole("link", { name: "Survie" });
  expect(server.getAttribute("href")).toContain("/networks/$networkId/servers/$serverId|");
  expect(screen.getByText("main")).toHaveAttribute("aria-current", "page");
});

it("shows only the project outside a network (demo)", () => {
  render(<ProjectBreadcrumb networkRef={null} serverRef={null} projectName="Welcome" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Welcome")).toHaveAttribute("aria-current", "page");
});
