import * as serversApi from "@/lib/api/servers";
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
  vi.spyOn(serversApi, "listServers").mockResolvedValue([
    { id: "sk_1", label: "Survie", online: true, minecraftVersion: "1.21.4", lastSeenAt: null },
    { id: "sk_2", label: "Lobby", online: false, minecraftVersion: null, lastSeenAt: null },
  ]);
});

it("switches server from a menu (its label in the tooltip), and ends on the project", async () => {
  render(<ProjectBreadcrumb serverRef="sk_1" projectName="main" />);
  const server = await screen.findByRole("button", { name: /Survie/ });
  expect(server).toHaveAttribute("title", "Survie");
  fireEvent.keyDown(server, { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitem", { name: "Lobby" }));
  expect(navigate).toHaveBeenCalledWith({
    to: "/servers/$serverId",
    params: { serverId: "sk_2" },
  });
  expect(screen.getByText("main")).toHaveAttribute("aria-current", "page");
});

it("shows only the project outside a server (demo)", () => {
  render(<ProjectBreadcrumb serverRef={null} projectName="Welcome" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Welcome")).toHaveAttribute("aria-current", "page");
});

it("with a Document open, leads back to the project and its collection, and ends on the Document", () => {
  const toProject = vi.fn();
  const open = vi.fn();
  render(
    <ProjectBreadcrumb
      serverRef={null}
      projectName="conversations"
      trail={{ toProject, collection: { label: "Modes d'affichage", open }, label: "<gold>HUD" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "conversations" }));
  expect(toProject).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Modes d'affichage" }));
  expect(open).toHaveBeenCalled();
  const current = document.querySelector('[aria-current="page"]');
  expect(current?.textContent).toBe("HUD");
});
