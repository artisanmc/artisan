import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NetworkDetailPage } from "./networks.$networkId";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "n1" }),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

describe("NetworkDetailPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders network name, packs, and server_keys sections", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [{ id: "p1", name: "shop", hash: "h" }],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    render(<NetworkDetailPage />);
    await screen.findByText("Alpha");
    expect(screen.getByText("shop")).toBeInTheDocument();
    expect(screen.getByText("my-server")).toBeInTheDocument();
  });

  it("renders 'Aucun pack' when packs empty", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Empty", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<NetworkDetailPage />);
    await screen.findByText(/Aucun pack/i);
  });

  it("shows server key id when label is null", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc123", label: null }],
    });
    render(<NetworkDetailPage />);
    await screen.findByText(/sk_abc123/);
  });

  it("calls deleteServerKey when delete button clicked and confirmed", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const delSpy = vi.spyOn(networksApi, "deleteServerKey").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NetworkDetailPage />);
    const btn = await screen.findByRole("button", { name: /Supprimer/i });
    fireEvent.click(btn);
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith("n1", "sk_abc"));
    // key removed from list
    await waitFor(() => expect(screen.queryByText("my-server")).not.toBeInTheDocument());
  });

  it("does NOT call deleteServerKey when confirm is cancelled", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const delSpy = vi.spyOn(networksApi, "deleteServerKey").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NetworkDetailPage />);
    const btn = await screen.findByRole("button", { name: /Supprimer/i });
    fireEvent.click(btn);
    expect(delSpy).not.toHaveBeenCalled();
    // key still visible
    expect(screen.getByText("my-server")).toBeInTheDocument();
  });
});
