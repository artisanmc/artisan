import * as networksApi from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
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
    serverKeys: [
      { id: "sk_1", slug: "survie", label: "Survie", online: true },
      { id: "sk_2", slug: "lobby", label: "Lobby" },
    ],
  } as never);
});

it("switches server from a menu (network in its tooltip), and ends on the project", async () => {
  render(<ProjectBreadcrumb serverRef="survie" projectName="main" />);
  expect(screen.queryByText("Primalcraft")).toBeNull();
  const server = await screen.findByRole("button", { name: /Survie/ });
  expect(server).toHaveAttribute("title", "Primalcraft › Survie");
  fireEvent.keyDown(server, { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitem", { name: "Lobby" }));
  expect(navigate).toHaveBeenCalledWith({
    to: "/servers/$serverId",
    params: { serverId: "lobby" },
  });
  expect(screen.getByText("main")).toHaveAttribute("aria-current", "page");
});

it("shows only the project outside a server (demo)", () => {
  render(<ProjectBreadcrumb serverRef={null} projectName="Welcome" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Welcome")).toHaveAttribute("aria-current", "page");
});
