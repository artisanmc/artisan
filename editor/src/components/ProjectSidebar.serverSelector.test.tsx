import { listServerProjects } from "@/lib/api/projectFiles";
import * as serversApi from "@/lib/api/servers";
import { useProjectsStore } from "@/state/projectsStore";
import { useServersStore } from "@/state/serversStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar, serverEntriesOf } from "./ProjectSidebar";

vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: ["shop"] })),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ serverId: "u-local" }),
    useSearch: () => ({}),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const status = (id: string, over: Partial<serversApi.ServerSummary> = {}) => ({
  id,
  label: id,
  online: true,
  minecraftVersion: null,
  lastSeenAt: null,
  ...over,
});

describe("serverEntriesOf", () => {
  it("turns the hub's list into selector rows with their live state", () => {
    const rows = serverEntriesOf([
      status("u-local", { label: "Hub" }),
      status("lobby", { online: false }),
      status("minigames", { updateRequired: true }),
    ]);
    expect(rows.map((e) => [e.serverId, e.serverLabel, e.online, e.updateRequired])).toEqual([
      ["u-local", "Hub", true, false],
      ["lobby", "lobby", false, false],
      ["minigames", "minigames", true, true],
    ]);
  });
});

describe("ProjectSidebar served by the plugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(listServerProjects).mockResolvedValue({ ok: true, projectIds: ["shop"] });
    useServersStore.setState({ activeServerId: null } as any);
    useProjectsStore.setState({ openProjects: { projects: [], projectOrder: [] } } as any);
    vi.spyOn(serversApi, "listServers").mockResolvedValue([
      status("u-local", { label: "Hub" }),
      status("lobby", { online: false }),
    ]);
  });

  it("lists the hub's servers with their connected state", async () => {
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
