import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ServerStatusBadge } from "./ServerStatusBadge";
import * as networksApi from "@/lib/api/networks";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

describe("ServerStatusBadge", () => {
  beforeEach(() => navigate.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when networkId is null", () => {
    const { container } = render(<ServerStatusBadge networkId={null} packId={"p1"} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the pack has no bindings", async () => {
    vi.spyOn(networksApi, "listPackBindings").mockResolvedValue([]);
    const { container } = render(<ServerStatusBadge networkId={"n1"} packId={"p1"} />);
    // Wait a tick for the async fetch to resolve, then confirm no button.
    await waitFor(() => expect(networksApi.listPackBindings).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows online + offline counts when both exist", async () => {
    vi.spyOn(networksApi, "listPackBindings").mockResolvedValue([
      { bindingId: "b1", serverKeyId: "sk1", serverKeyLabel: null, branchName: "main", createdAt: "", lastMcVersion: null, online: true },
      { bindingId: "b2", serverKeyId: "sk2", serverKeyLabel: null, branchName: "main", createdAt: "", lastMcVersion: null, online: false },
      { bindingId: "b3", serverKeyId: "sk3", serverKeyLabel: null, branchName: "main", createdAt: "", lastMcVersion: null, online: false },
    ]);
    render(<ServerStatusBadge networkId={"n1"} packId={"p1"} />);
    const btn = await screen.findByRole("button");
    expect(btn.textContent).toContain("1");
    expect(btn.textContent).toContain("2");
  });

  it("click navigates to the servers tab", async () => {
    vi.spyOn(networksApi, "listPackBindings").mockResolvedValue([
      { bindingId: "b1", serverKeyId: "sk1", serverKeyLabel: null, branchName: "main", createdAt: "", lastMcVersion: null, online: true },
    ]);
    render(<ServerStatusBadge networkId={"n1"} packId={"p1"} />);
    const btn = await screen.findByRole("button");
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith({
      to: "/workspace/$workspaceId",
      params: { workspaceId: "p1" },
      search: { tab: "servers" },
    });
  });
});
