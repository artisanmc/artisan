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
      serverKeys: [{ id: "sk_abc123456789", label: null }],
    });
    render(<NetworkDetailPage />);
    // The card now shows the id as the subtitle (full) and a truncated version
    // as the title — assert at least one match.
    const matches = await screen.findAllByText(/sk_abc12345/);
    expect(matches.length).toBeGreaterThan(0);
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

  it("calls rotateServerKey when rotate button is clicked + confirmed, reveals the new key", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const rotSpy = vi.spyOn(networksApi, "rotateServerKey").mockResolvedValue({
      id: "sk_abc",
      key: "sk_NEW_PLAINTEXT_VALUE_1234",
      label: "my-server",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NetworkDetailPage />);
    const btn = await screen.findByRole("button", { name: /Renouveler/i });
    fireEvent.click(btn);
    await waitFor(() => expect(rotSpy).toHaveBeenCalledWith("n1", "sk_abc"));
    // Modal reveals the plaintext key once.
    await screen.findByText("sk_NEW_PLAINTEXT_VALUE_1234");
    // Old key card stays — rotation preserves the id.
    expect(screen.getByText("my-server")).toBeInTheDocument();
  });

  it("does NOT call rotateServerKey when confirm is cancelled", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const rotSpy = vi.spyOn(networksApi, "rotateServerKey").mockResolvedValue({
      id: "sk_abc", key: "sk_irrelevant", label: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NetworkDetailPage />);
    const btn = await screen.findByRole("button", { name: /Renouveler/i });
    fireEvent.click(btn);
    expect(rotSpy).not.toHaveBeenCalled();
  });

  it("loads the hello audit log lazily when the panel is expanded", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const helloSpy = vi.spyOn(networksApi, "listServerKeyHelloes").mockResolvedValue([
      { id: "h1", ip: "203.0.113.42", mcVersion: "1.21.4", helloAt: "2026-06-01T08:00:00Z", rejectedReason: null },
    ]);
    render(<NetworkDetailPage />);
    // Panel is collapsed by default → API not called yet.
    await screen.findByText("my-server");
    expect(helloSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Connexions récentes/i }));
    await waitFor(() => expect(helloSpy).toHaveBeenCalledWith("n1", "sk_abc"));
    await screen.findByText("203.0.113.42");
  });

  it("renders rejected hello with a badge", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    vi.spyOn(networksApi, "listServerKeyHelloes").mockResolvedValue([
      { id: "h1", ip: "198.51.100.7", mcVersion: "1.21.4", helloAt: "2026-06-01T08:00:00Z", rejectedReason: "ip_not_allowed" },
    ]);
    render(<NetworkDetailPage />);
    await screen.findByText("my-server");
    fireEvent.click(screen.getByRole("button", { name: /Connexions récentes/i }));
    await screen.findByText("198.51.100.7");
    expect(screen.getByText(/IP hors allowlist/i)).toBeInTheDocument();
  });

  it("allowlist panel: lazy-loads, adds, removes IPs", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    const getSpy = vi.spyOn(networksApi, "getServerKeyAllowlist").mockResolvedValue(["1.2.3.4"]);
    const setSpy = vi.spyOn(networksApi, "setServerKeyAllowlist").mockImplementation(
      async (_n, _k, list) => list,
    );

    render(<NetworkDetailPage />);
    await screen.findByText("my-server");
    expect(getSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Allowlist d'IP/i }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith("n1", "sk_abc"));
    await screen.findByText("1.2.3.4");

    // Add a new IP.
    const input = screen.getByPlaceholderText("203.0.113.42");
    fireEvent.change(input, { target: { value: "5.6.7.8" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter/i }));
    await waitFor(() =>
      expect(setSpy).toHaveBeenCalledWith("n1", "sk_abc", ["1.2.3.4", "5.6.7.8"]),
    );

    // Remove the original IP (the new state from setSpy is ["1.2.3.4", "5.6.7.8"]).
    await screen.findByText("5.6.7.8");
    const removeButtons = screen.getAllByRole("button", { name: /Retirer/i });
    fireEvent.click(removeButtons[0]);
    await waitFor(() =>
      expect(setSpy).toHaveBeenCalledWith("n1", "sk_abc", ["5.6.7.8"]),
    );
  });

  it("allowlist panel: removing the last IP sends null to clear", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [],
      serverKeys: [{ id: "sk_abc", label: "my-server" }],
    });
    vi.spyOn(networksApi, "getServerKeyAllowlist").mockResolvedValue(["1.2.3.4"]);
    const setSpy = vi.spyOn(networksApi, "setServerKeyAllowlist").mockImplementation(
      async (_n, _k, list) => list,
    );

    render(<NetworkDetailPage />);
    await screen.findByText("my-server");
    fireEvent.click(screen.getByRole("button", { name: /Allowlist d'IP/i }));
    await screen.findByText("1.2.3.4");
    fireEvent.click(screen.getByRole("button", { name: /Retirer/i }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith("n1", "sk_abc", null));
  });
});
