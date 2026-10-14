import * as networksApi from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar, withServersStatus } from "./ProjectSidebar";

vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: ["shop"] })),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ serverId: "local" }),
    useSearch: () => ({}),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const status = (id: string, over: Partial<networksApi.ServerStatusEntry> = {}) => ({
  id,
  label: id,
  online: true,
  lastMcVersion: null,
  lastSeenAt: null,
  lastSeenIp: null,
  isCurrent: false,
  ...over,
});

const hub = { networkId: "local", networkName: "Hub", networkSlug: "local" };

describe("withServersStatus", () => {
  it("merges the live state and adds a server connected since the page loaded", () => {
    const entries = [{ ...hub, serverId: "local", serverSlug: "local", serverLabel: "Hub" }];
    const merged = withServersStatus(entries, "local", [
      status("local"),
      status("lobby", { online: false }),
      status("minigames", { updateRequired: true }),
    ]);
    expect(merged.map((e) => [e.serverId, e.online, e.updateRequired])).toEqual([
      ["local", true, false],
      ["lobby", false, false],
      ["minigames", true, true],
    ]);
    expect(merged[1]).toMatchObject({ serverSlug: "lobby", networkName: "Hub" });
  });

  it("keeps the state unknown for a server the status does not list", () => {
    const entries = [{ ...hub, serverId: "local", serverLabel: "Hub" }];
    expect(withServersStatus(entries, "local", [])[0]!.online).toBeUndefined();
  });
});

describe("ProjectSidebar served by the plugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(listServerProjects).mockResolvedValue({ ok: true, projectIds: ["shop"] });
    useNetworksStore.setState({
      networks: [{ id: "local", slug: "local", name: "Hub", tier: "free" }],
    } as any);
    useServersStore.setState({ activeServerId: null } as any);
    useAccountStore.setState({ account: { id: "", projects: [], projectOrder: [] } } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "local", slug: "local", name: "Hub", tier: "free" },
      projects: [],
      serverKeys: [
        { id: "local", slug: "local", label: "Hub", online: true },
        { id: "lobby", slug: "lobby", label: "lobby", online: false },
      ],
    });
    vi.spyOn(networksApi, "getNetworkServersStatus").mockResolvedValue({
      online: 1,
      total: 2,
      servers: [status("local", { label: "Hub" }), status("lobby", { online: false })],
    });
  });

  it("lists the network's servers with their connected state", async () => {
    render(<ProjectSidebar />);
    await screen.findByTestId("server-state-online");
    await userEvent.click(screen.getByText("Hub", { selector: "span.truncate" }));
    expect(screen.getByText("lobby")).toBeInTheDocument();
    expect(screen.getByTestId("server-state-offline")).toBeInTheDocument();
  });

  it("explains an update-required server instead of calling it unreachable", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "plugin_update_required" });
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Update required|Mise à jour requise/)).toBeInTheDocument();
  });
});
