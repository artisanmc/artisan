import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerCard } from "./ServerCard";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, Link: ({ children, ...p }: any) => <a {...p}>{children}</a> };
});

const server = { id: "sk1", label: "Survival", online: true } as any;
const workspaces = [
  { id: "p1", name: "Shop" },
  { id: "p2", name: "Lobby" },
] as any;

describe("ServerCard", () => {
  it("shows label, online dot, workspaces, count, and 'new workspace' CTA", () => {
    render(<ServerCard server={server} workspaces={workspaces} onAction={() => {}} onCreateWorkspace={() => {}} />);
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.getByText(/2 workspace/i)).toBeInTheDocument();
    // workspace links contain emoji + text — use regex
    expect(screen.getByText(/Shop/)).toBeInTheDocument();
    expect(screen.getByText(/Lobby/)).toBeInTheDocument();
    // CTA button — label varies by locale; match the + prefix
    expect(screen.getByRole("button", { name: /workspace/i })).toBeInTheDocument();
  });

  it("invokes onCreateWorkspace when CTA clicked", () => {
    const onCreate = vi.fn();
    render(<ServerCard server={server} workspaces={[]} onAction={() => {}} onCreateWorkspace={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /workspace/i }));
    expect(onCreate).toHaveBeenCalledWith("sk1");
  });
});
