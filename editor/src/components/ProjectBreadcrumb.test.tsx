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

it("names the module alone: the server is the sidebar's row", () => {
  render(<ProjectBreadcrumb projectName="main" />);
  expect(screen.queryByText("Survie")).toBeNull();
  expect(screen.getByText("main")).toHaveAttribute("aria-current", "page");
});

it("puts the server's state before the module", () => {
  render(<ProjectBreadcrumb projectName="main" status={<span>down</span>} />);
  expect(screen.getByText("down")).toBeInTheDocument();
});

it("shows only the project (demo)", () => {
  render(<ProjectBreadcrumb projectName="Welcome" />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Welcome")).toHaveAttribute("aria-current", "page");
});

it("with a Document open, leads back to the project and its collection, and ends on the Document", () => {
  const toProject = vi.fn();
  const open = vi.fn();
  render(
    <ProjectBreadcrumb
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

it("with a part of the Document selected, the Document leads back to itself and the part ends the trail", () => {
  const close = vi.fn();
  render(
    <ProjectBreadcrumb
      projectName="quests"
      trail={{ toProject: vi.fn(), label: "Guild levels", part: { label: "Level 2", close } }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Guild levels" }));
  expect(close).toHaveBeenCalled();
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("Level 2");
});
