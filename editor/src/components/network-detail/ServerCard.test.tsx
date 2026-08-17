import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerCard } from "./ServerCard";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, to, params, ...p }: any) => <a href={to} {...p}>{children}</a>,
  };
});

const server = { id: "sk1", label: "Survival", online: true } as any;
const workspaces = [
  { id: "p1", name: "Shop" },
  { id: "p2", name: "Lobby" },
] as any;

describe("ServerCard", () => {
  /**
   * Serveur hors ligne : le backend ne liste pas ses Projects — c'est SON disque
   * qui les porte (ADR `server-disk-only-storage`). Afficher « 0 projet » ferait
   * croire qu'il n'en a pas, alors qu'on ne peut simplement pas savoir. La carte
   * doit dire lequel des deux.
   */
  it("dit qu'un serveur hors ligne est illisible, pas qu'il est vide", () => {
    const offline = { id: "sk2", label: "Creative", online: false } as any;
    render(<ServerCard networkId="net_1" server={offline} workspaces={[]} onAction={() => {}} onCreateProject={() => {}} />);
    expect(screen.getByText(/hors ligne|offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0 projet/i)).not.toBeInTheDocument();
  });

  it("shows label, online dot, workspaces, count, and 'new workspace' CTA", () => {
    render(<ServerCard networkId="net_1" server={server} workspaces={workspaces} onAction={() => {}} onCreateProject={() => {}} />);
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.getByText(/2 projet/i)).toBeInTheDocument();
    // workspace links contain emoji + text — use regex
    expect(screen.getByText(/Shop/)).toBeInTheDocument();
    expect(screen.getByText(/Lobby/)).toBeInTheDocument();
    // CTA button — label varies by locale; match the + prefix
    expect(screen.getByRole("button", { name: /projet/i })).toBeInTheDocument();
  });

  it("workspace links point to the server-scoped URL pattern", () => {
    render(<ServerCard networkId="net_1" server={server} workspaces={workspaces} onAction={() => {}} onCreateProject={() => {}} />);
    const links = screen.getAllByRole("link");
    // Links use TanStack Router `to` pattern as href (mocked Link renders href=to)
    expect(links[0]).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/projects/$projectId",
    );
  });

  it("invokes onCreateProject when CTA clicked", () => {
    const onCreate = vi.fn();
    render(<ServerCard networkId="net_1" server={server} workspaces={[]} onAction={() => {}} onCreateProject={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /projet/i }));
    expect(onCreate).toHaveBeenCalledWith("sk1");
  });
});
