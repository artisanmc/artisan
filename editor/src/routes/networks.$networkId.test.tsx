import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders network name + one server card per server, with workspaces nested", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [
        { id: "p1", name: "Shop", hash: "h", serverKeyId: "sk1" },
        { id: "p2", name: "Lobby", hash: "h", serverKeyId: "sk1" },
        { id: "p3", name: "Welcome", hash: "h", serverKeyId: "sk2" },
      ],
      serverKeys: [
        { id: "sk1", label: "Survival" },
        { id: "sk2", label: "Hub" },
      ],
    });
    render(<NetworkDetailPage />);
    await screen.findByText("Alpha");
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText(/Shop/)).toBeInTheDocument();
    expect(screen.getByText(/Lobby/)).toBeInTheDocument();
    expect(screen.getByText(/Welcome/)).toBeInTheDocument();
  });

  it("shows empty state when network has no servers", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Empty", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<NetworkDetailPage />);
    await screen.findByText(/Aucun serveur|No server/i);
  });

  it("shows loading state before data resolves", () => {
    vi.spyOn(networksApi, "getNetwork").mockImplementation(() => new Promise(() => {}));
    render(<NetworkDetailPage />);
    expect(screen.getByText(/chargement|loading/i)).toBeInTheDocument();
  });
});
