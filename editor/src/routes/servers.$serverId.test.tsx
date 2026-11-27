import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateSpy = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: { id: "u1", name: "Iban" } as { id: string; name: string } | null,
  isLoading: false,
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

function setUrl(pathname: string, search = "") {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, pathname, search },
  });
}

const routerState = vi.hoisted(() => ({ childMatches: [] as unknown[] }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => routerState.childMatches,
    Outlet: () => <div>child-route</div>,
    useParams: () => ({ serverId: "sk_1" }),
    useNavigate: () => navigateSpy,
    Navigate: () => null,
    Link: ({ children, to, params, ...p }: any) => (
      <a href={to} {...p}>
        {children}
      </a>
    ),
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/servers", () => ({
  listServers: vi
    .fn()
    .mockResolvedValue([
      { id: "sk_1", label: "Survival", online: true, minecraftVersion: null, lastSeenAt: null },
    ]),
}));

vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn().mockResolvedValue({ ok: true, projectIds: ["Hub", "boutique_shop"] }),
}));

const screensState = vi.hoisted(() => ({
  screens: [] as Array<Record<string, unknown>>,
  load: vi.fn(),
}));
vi.mock("@/state/serverScreensStore", () => ({
  useServerScreensStore: Object.assign(
    (sel: (s: typeof screensState) => unknown) => sel(screensState),
    { getState: () => screensState },
  ),
}));

const accountState = vi.hoisted(() => ({ openProjects: { projects: [] as unknown[] } }));
vi.mock("@/state/projectsStore", () => ({
  useProjectsStore: (sel: (s: typeof accountState) => unknown) => sel(accountState),
}));

const modulesState = vi.hoisted(() => ({ mountedIds: [] as string[], active: [] as unknown[] }));
vi.mock("@/state/modulesStore", () => ({
  useModulesStore: (sel: (s: typeof modulesState) => unknown) => sel(modulesState),
}));

vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) =>
    id === "boutique" ? { id: "boutique", displayName: "Boutique", routes: [] } : undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("@/lib/api/projectVersions", () => ({
  listProjectVersions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/api/onlinePlayers", () => ({
  listOnlinePlayers: vi.fn().mockResolvedValue(["Steve", "Alex"]),
}));

vi.mock("@/features/project/publish/otherDrafts", () => ({
  loadOtherDrafts: vi.fn().mockResolvedValue([]),
}));

import { loadOtherDrafts } from "@/features/project/publish/otherDrafts";
import { listServerProjects } from "@/lib/api/projectFiles";
import { listProjectVersions } from "@/lib/api/projectVersions";
import { listServers } from "@/lib/api/servers";
import ServerDetailPage from "./servers.$serverId";

describe("ServerDetailPage", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    authState.currentUser = { id: "u1", name: "Iban" };
    authState.isLoading = false;
    routerState.childMatches = [];
    screensState.screens = [];
    screensState.load.mockClear();
    vi.mocked(listServerProjects).mockClear();
    vi.mocked(listServers).mockClear();
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["Hub", "boutique_shop"],
    });
    modulesState.mountedIds = [];
  });

  it("redirects anonymous visitors to /login with a next return path", async () => {
    authState.currentUser = null;
    authState.isLoading = false;
    setUrl("/servers/sk_1", "?x=1");

    render(<ServerDetailPage />);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/servers/sk_1?x=1" },
        replace: true,
      }),
    );
  });

  it("does not redirect a logged-in user", async () => {
    setUrl("/servers/sk_1");
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  /**
   * The list comes from the server's disk, like the sidebar (ADR
   * `server-disk-only-storage`). The URL slug must be resolved to an id before
   * the call.
   */
  it("reads the Projects from the server's disk, by resolved ids", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalledWith("sk_1"));
  });

  /**
   * No Document counter here: the hub does not hold the files (ADR
   * `server-disk-only-storage`), so it cannot know it without querying the
   * server's disk.
   */
  it("no longer shows a Documents counter — the backend no longer knows it", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("workspace link points to the new URL pattern", async () => {
    render(<ServerDetailPage />);
    const link = await screen.findByRole("link", { name: /Hub/ });
    expect(link).toHaveAttribute("href", "/servers/$serverId/projects/$projectId");
  });

  /** Same split as the sidebar: a folder shipped by an Add-on is one row under its module's
   *  name; its screens are views of the folder (its header's More). */
  it("lists an owned folder once, under its module's name, beside the admin's folders", async () => {
    screensState.screens = [
      {
        id: "catalogue",
        moduleId: "boutique",
        label: "Catalogue",
        table: "data/catalogue",
        projectId: "boutique_shop",
      },
    ];
    render(<ServerDetailPage />);
    const rows = await screen.findByTestId("overview-modules");
    const row = (await within(rows).findByText("Boutique")).closest("a")!;
    expect(row).toHaveAttribute("href", "/servers/$serverId/projects/$projectId");
    expect(within(row).getByText("serverDetail.overview.addon")).toBeInTheDocument();
    expect(within(rows).queryByText(/boutique_shop/)).toBeNull();
    expect(within(rows).getByText("Hub")).toBeInTheDocument();
    // No screen links here: they are views of the folder.
    expect(screen.queryByRole("link", { name: "Catalogue" })).toBeNull();
  });

  it("shows each module's last deployment and the latest ones of the server", async () => {
    vi.mocked(listProjectVersions).mockImplementation(async (id: string) =>
      id === "sk_1.Hub"
        ? [
            {
              id: "1",
              hash: "h",
              createdAt: new Date().toISOString(),
              author: { id: "u", name: "Kaelis" },
              changed: ["menus/main.yml"],
            },
          ]
        : [],
    );
    render(<ServerDetailPage />);
    const rows = await screen.findByTestId("overview-modules");
    await waitFor(() =>
      expect(within(rows).getByText("serverDetail.overview.by")).toBeInTheDocument(),
    );
    expect(within(rows).getByText("serverDetail.overview.neverDeployed")).toBeInTheDocument();
    const activity = await screen.findByTestId("overview-activity");
    expect(within(activity).getByText("menus/main.yml")).toBeInTheDocument();
    vi.mocked(listProjectVersions).mockResolvedValue([]);
  });

  it("lists the player's changes waiting on this server, and reviews them on demand", async () => {
    vi.mocked(loadOtherDrafts).mockResolvedValue([
      {
        projectId: "sk_1.Hub",
        projectName: "Hub",
        serverId: "sk_1",
        serverLabel: "Survival",
        draftId: "d1",
        draftName: "Draft",
        revision: 1,
        changes: { before: { "a.yml": "a: 1" }, after: { "a.yml": "a: 2", "b.yml": "b: 1" } },
        unsynced: false,
      },
    ]);
    render(<ServerDetailPage />);
    expect(await screen.findByText("serverDetail.overview.pendingTitle")).toBeInTheDocument();
    expect(vi.mocked(loadOtherDrafts)).toHaveBeenCalledWith(undefined, "sk_1");
    expect(screen.getByText("serverDetail.overview.files")).toBeInTheDocument();
    expect(screen.getByText("serverDetail.overview.pending")).toBeInTheDocument();
    vi.mocked(loadOtherDrafts).mockResolvedValue([]);
  });

  /**
   * Until the disk has answered, the page claims nothing: showing "no project"
   * during the read asserts an emptiness not observed — exactly what gave an
   * "empty" server on first render.
   */
  it("does not announce an empty server until the disk read has answered", async () => {
    vi.mocked(listServerProjects).mockReturnValue(new Promise(() => {}) as never);
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.loadingProjects");
    expect(screen.queryByText("serverDetail.noProjects")).not.toBeInTheDocument();
  });

  it("says the server is unreachable when the disk read fails", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "read_error" });
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.projectsUnavailable");
    expect(screen.queryByText("serverDetail.noProjects")).not.toBeInTheDocument();
  });

  it("says the server is offline when it answers server_offline", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "server_offline" });
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.serverOffline");
  });

  it("plugin needs an update: says so, and offers neither import nor configuration", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: false,
      error: "plugin_update_required",
    });
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.updateRequired");
    expect(screen.getByText("serverDetail.overview.importModule")).toBeDisabled();
    expect(screen.queryByText("serverDetail.overview.newModule")).toBeNull();
    expect(screen.queryByText("serverConfig.title")).not.toBeInTheDocument();
  });

  /** Config screens decide the grouping: the page loads them for ITS server,
   *  otherwise an owned project first appears flat then jumps. */
  it("loads the Config screens of its own server", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screensState.load).toHaveBeenCalledWith({ serverId: "sk_1" }));
  });

  /**
   * When a child route fills the screen (a Project's canvas), this page is only
   * a pass-through: it must neither read the disk nor subscribe to editing
   * state. Otherwise every keystroke in the editor re-rendered the parent, hence
   * the `<Outlet>`, hence the whole canvas.
   */
  it("does not read the disk when a child route is shown", async () => {
    routerState.childMatches = [{ id: "child" }];
    render(<ServerDetailPage />);
    await waitFor(() => expect(listServers).toHaveBeenCalled());
    expect(listServerProjects).not.toHaveBeenCalled();
  });

  it("shows the server's tabs, the overview active when no child route matches", async () => {
    render(<ServerDetailPage />);
    const nav = await screen.findByRole("navigation", { name: "serverDetail.tabs.label" });
    const tabs = within(nav).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "serverDetail.tabs.overview",
      "serverDetail.tabs.resources",
      "serverDetail.tabs.play",
      "serverDetail.tabs.assistant",
    ]);
    // The tabs opened now and then are under More (`ServerTabs.test.tsx`).
    expect(within(nav).getByRole("button", { name: "serverDetail.tabs.more" })).toBeTruthy();
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("serverDetail.stateOnline")).toBeInTheDocument();
  });

  it("titles the page with the server's name alone: the sidebar's row switches servers", async () => {
    render(<ServerDetailPage />);
    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(heading).toHaveTextContent("Survival"));
    expect(within(heading).queryByRole("button")).toBeNull();
  });

  it("keeps the frame around a tab's route, without reading the disk itself", async () => {
    routerState.childMatches = [{ id: "child", routeId: "/servers/$serverId/settings" }];
    render(<ServerDetailPage />);
    expect(await screen.findByText("child-route")).toBeInTheDocument();
    // A tab of More: its button names it.
    const settings = screen.getByRole("button", { name: "serverDetail.tabs.settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(listServerProjects).not.toHaveBeenCalled();
  });

  it("gives a project the whole screen, without the frame", async () => {
    routerState.childMatches = [{ id: "child", routeId: "/servers/$serverId/projects/$projectId" }];
    render(<ServerDetailPage />);
    expect(await screen.findByText("child-route")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  /** Server unknown to the hub: the URL is stale, go back to the server list
   *  rather than spinning forever on "reading". */
  it("redirects to the server list when the server does not exist", async () => {
    vi.mocked(listServers).mockResolvedValueOnce([
      { id: "sk_9", label: "Autre", online: true, minecraftVersion: null, lastSeenAt: null },
    ]);
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/servers", replace: true }),
    );
  });

  it("403 for a logged-in user says access is denied instead of bouncing", async () => {
    vi.mocked(listServers).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.accessDenied");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("404 still bounces to /servers", async () => {
    vi.mocked(listServers).mockRejectedValueOnce(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/servers", replace: true }),
    );
  });
});
