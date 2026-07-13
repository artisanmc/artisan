import * as networksApi from "@/lib/api/networks";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkDetailPage } from "./networks.$networkId";

const authState = vi.hoisted(() => ({
  currentUser: { id: "u1", name: "Iban" } as { id: string; name: string } | null,
  isLoading: false,
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

const navigateSpy = vi.hoisted(() => vi.fn());
const childMatchesState = vi.hoisted(() => ({ matches: [] as unknown[] }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => childMatchesState.matches,
    useParams: () => ({ networkId: "n1" }),
    useNavigate: () => navigateSpy,
    Outlet: () => <div data-testid="outlet" />,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

function setUrl(pathname: string, search = "") {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, pathname, search },
  });
}

describe("NetworkDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateSpy.mockClear();
    authState.currentUser = { id: "u1", name: "Iban" };
    authState.isLoading = false;
    childMatchesState.matches = [];
  });

  it("redirects anonymous visitors to /login with a next return path", async () => {
    authState.currentUser = null;
    authState.isLoading = false;
    setUrl("/networks/n1", "?tab=settings");
    vi.spyOn(networksApi, "getNetwork").mockImplementation(() => new Promise(() => {}));

    render(<NetworkDetailPage />);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/networks/n1?tab=settings" },
        replace: true,
      }),
    );
  });

  it("does not redirect a logged-in user", async () => {
    setUrl("/networks/n1");
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      projects: [],
      serverKeys: [],
    });

    render(<NetworkDetailPage />);
    await screen.findByText("Alpha");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("renders network name + one server card per server, with workspaces nested", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      projects: [
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

  it("links to the billing/credits page from the header", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<NetworkDetailPage />);
    await screen.findByText("Alpha");
    const link = screen.getByText(/Facturation|Billing/i).closest("a");
    expect(link).toHaveAttribute("to", "/credits");
  });

  it("shows empty state when network has no servers", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Empty", tier: "free" },
      projects: [],
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

  it("403 for a logged-in user renders the request-access panel instead of bouncing", async () => {
    vi.spyOn(networksApi, "getNetwork").mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<NetworkDetailPage />);
    await screen.findByText(/don't have access|n'as pas accès/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("403 wins over a rendered child outlet — a member-less deep link must see the panel", async () => {
    childMatchesState.matches = [{ id: "child" }];
    vi.spyOn(networksApi, "getNetwork").mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<NetworkDetailPage />);
    await screen.findByText(/don't have access|n'as pas accès/i);
  });

  it("404 still bounces to /networks", async () => {
    vi.spyOn(networksApi, "getNetwork").mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    render(<NetworkDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/networks", replace: true }),
    );
  });
});
