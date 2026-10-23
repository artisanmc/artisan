import { onProjectsReloaded } from "@/features/project/onProjectsReloaded";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { listServerProjects } from "@/lib/api/projectFiles";
import * as serversApi from "@/lib/api/servers";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useServersStore } from "@/state/serversStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

const mockParams = vi.hoisted(() => ({
  current: { serverId: "sk_1" } as {
    serverId?: string;
    projectId?: string;
  },
}));

// The Project list comes from the active server's DISK (ADR
// `server-disk-only-storage`): the folder IS the identity, so the label
// shown is its folder name.
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: ["pack_a", "pack_b"] })),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => mockParams.current,
    useSearch: () => ({}),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const srv = (id: string, label: string): serversApi.ServerSummary => ({
  id,
  label,
  online: true,
  minecraftVersion: null,
  lastSeenAt: null,
});

describe("ProjectSidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // A previous test's `mockResolvedValue` would otherwise survive: reset the
    // default disk response before each test.
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["pack_a", "pack_b"],
    });
    mockParams.current = { serverId: "sk_1" };
    useServerScreensStore.setState({ screens: [] } as never);
    useSystemCommandsStore.setState({
      serverId: null,
      status: "idle",
      commands: [],
      overrides: {},
    });
    useServersStore.setState({ activeServerId: null } as any);
    useProjectsStore.setState({ openProjects: { projects: [], projectOrder: [] } } as any);
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
  });

  it("lists the active server's Projects from its disk, sorted", async () => {
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    const items = await screen.findAllByRole("link", { name: /pack_a|pack_b/ });
    // The order comes from the plugin (sorted folders): pack_a before pack_b. The
    // label is the folder name, which is the identity.
    expect(items[0]).toHaveTextContent("pack_a");
    expect(items[1]).toHaveTextContent("pack_b");
  });

  it("re-reads the list when the server announces a reload", async () => {
    render(<ProjectSidebar />);
    await screen.findByRole("link", { name: /pack_b/ });
    // An add-on registered its folder after the server started: only the reload says so.
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["pack_a", "pack_b", "shop"],
    });
    onProjectsReloaded("sk_1", []);
    expect(await screen.findByRole("link", { name: /shop/ })).toBeInTheDocument();
  });

  it("lists a module's system commands, marking the ones the admin disabled", async () => {
    const declared = (id: string, name: string) => ({
      id,
      moduleId: "attribution",
      name,
      aliases: [],
      permission: null,
      description: {},
      arguments: [],
      consoleAllowed: false,
      opensMenu: null,
      children: [],
    });
    useSystemCommandsStore.setState({
      serverId: "sk_1",
      status: "ready",
      commands: [declared("attribution:open", "attribution"), declared("attribution:top", "top")],
      folders: [],
      overrides: {
        "attribution:top": {
          command: "attribution:top",
          folder: "attribution",
          path: "overrides/command/attribution.top.yaml",
          content: "",
          fields: { enabled: false },
          hasLogic: false,
        },
      },
    });
    render(<ProjectSidebar />);
    // Folded with its module: nothing shows until the module is opened.
    const toggle = await screen.findByRole("button", {
      name: "Afficher les documents de attribution",
    });
    expect(screen.queryByRole("link", { name: "/attribution" })).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByRole("link", { name: "/attribution" })).toHaveAttribute(
      "href",
      "/servers/$serverId/commands/$commandId",
    );
    const disabled = screen.getByRole("link", { name: /\/top/ });
    expect(within(disabled).getByRole("img")).toHaveAccessibleName("Désactivée");
  });

  it("workspace links use the server-scoped URL pattern", async () => {
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    const link = await screen.findByRole("link", { name: /pack_a/ });
    expect(link).toHaveAttribute("href", "/servers/$serverId/projects/$projectId");
  });

  describe("document tree of the open project", () => {
    const loaded = (id: string) =>
      ({
        id,
        name: id,
        defaultLang: "fr",
        i18nKeys: {},
        documents: {
          menu: [{ id: "accueil", rows: 3, layers: [], title: [] }],
          command: [{ id: "c_heal", name: "heal", arguments: [], steps: [] }],
          dialog: [],
        },
      }) as never;

    beforeEach(() => {
      vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
      useProjectsStore.setState({
        openProjects: { projects: [loaded("pack_a"), loaded("pack_b")], projectOrder: [] },
      } as never);
      useServerIndexStore.getState().reset();
    });

    it("expands the open project into its documents, grouped by type", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /pack_a/ });
      expect(tree).toHaveTextContent("accueil");
      expect(tree).toHaveTextContent("/heal");
    });

    it("lists the commands its module declares with its own, marked as built in", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      useSystemCommandsStore.setState({
        serverId: "sk_1",
        status: "ready",
        commands: [
          {
            id: "shop:open",
            moduleId: "shop",
            name: "shop",
            aliases: [],
            permission: null,
            description: {},
            arguments: [],
            consoleAllowed: false,
            opensMenu: "pack_a:accueil",
            children: [],
          },
        ],
        folders: [{ folder: "pack_a", ownerModule: "shop" }],
        overrides: {},
      });
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /pack_a/ });
      const commands = within(tree).getByRole("list", { name: "Commandes" });
      expect(commands).toHaveTextContent("/heal");
      const builtIn = within(commands).getByRole("button", { name: /^\/shop/ });
      expect(within(builtIn).getByRole("img")).toHaveAccessibleName(
        /Commande interne du module shop/,
      );
    });

    it("puts settings and creation on the open project's row, no more 'Settings' row", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /pack_a/ });
      const row = screen.getByRole("link", { name: /pack_a/ }).parentElement as HTMLElement;
      expect(within(row).getByTestId("project-settings")).toBeInTheDocument();
      expect(within(row).getByTestId("project-create")).toBeInTheDocument();
      expect(within(tree).queryByTestId("project-settings")).toBeNull();
      expect(tree).not.toHaveTextContent(/Paramètres du projet/);
    });

    it("does not expand projects that are not open", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      await screen.findByRole("group", { name: /pack_a/ });
      expect(screen.getAllByRole("group", { name: /documents/i })).toHaveLength(1);
    });

    it("expands another project on demand, from its published state", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      useServerIndexStore.setState({
        scope: "net_1/sk_1",
        status: "ready",
        failed: [],
        projects: [
          {
            id: "pack_b",
            name: "pack_b",
            defaultLang: "fr",
            i18nKeys: {},
            documents: {
              menu: [{ id: "catalogue", rows: 3, layers: [], title: [] }],
              command: [],
              dialog: [],
            },
          } as never,
        ],
      });
      render(<ProjectSidebar />);
      const toggle = await screen.findByRole("button", { name: /pack_b/, expanded: false });
      expect(screen.queryByRole("group", { name: /Documents de pack_b/ })).toBeNull();
      fireEvent.click(toggle);
      expect(screen.getByRole("group", { name: /Documents de pack_b/ })).toHaveTextContent(
        "catalogue",
      );
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("shows the open project even when it is not listed (demo, no server)", async () => {
      mockParams.current = { projectId: "pack_a" };
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /Documents de pack_a/ });
      expect(tree).toHaveTextContent("accueil");
    });

    it("expands nothing outside a project", async () => {
      render(<ProjectSidebar />);
      await screen.findByRole("link", { name: /pack_a/ });
      expect(screen.queryByRole("group", { name: /documents/i })).toBeNull();
    });
  });

  it("counts a project never opened from its published state", async () => {
    useServerIndexStore.setState({
      scope: "sk_1",
      status: "ready",
      failed: [],
      projects: [
        {
          id: "pack_b",
          name: "pack_b",
          defaultLang: "fr",
          i18nKeys: {},
          documents: {
            menu: [{ id: "catalogue", rows: 3, layers: [], title: [] }],
            command: [],
            dialog: [],
            "shop:offer": [{ id: "vip" }],
          },
        } as never,
      ],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByLabelText("2 éléments")).toBeInTheDocument();
  });

  it("lists a plugin's folder under its module, before the admin's own", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["boutique_shop", "pack_a"],
      projects: [
        {
          id: "boutique_shop",
          name: "boutique_shop",
          externalId: "boutique_shop",
          hash: "",
          serverKeyId: "sk_1",
          ownerModule: "boutique",
        },
      ],
    } as never);
    render(<ProjectSidebar />);
    const moduleLink = await screen.findByRole("link", { name: "boutique" });
    expect(moduleLink).toHaveAttribute("href", "/servers/$serverId/projects/$projectId");
    expect(screen.queryByRole("link", { name: /boutique_shop/ })).toBeNull();
    const installed = screen.getByText("Modules installés");
    const mine = screen.getByText("Mes modules");
    expect(installed.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      mine.compareDocumentPosition(screen.getByRole("link", { name: /pack_a/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists a module's screens as rows of their own once the module is opened, without a header", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["boutique_shop"],
      projects: [
        {
          id: "boutique_shop",
          name: "boutique_shop",
          externalId: "boutique_shop",
          hash: "",
          serverKeyId: "sk_1",
          ownerModule: "boutique",
        },
      ],
    } as never);
    useServerScreensStore.setState({
      screens: [
        {
          id: "catalogue",
          moduleId: "boutique",
          label: "Catalogue",
          table: "catalogue",
          projectId: "boutique_shop",
        },
      ],
    } as never);
    render(<ProjectSidebar />);
    // The module's row is its folder once the disk listing arrives.
    await screen.findByRole("link", { name: "boutique" });
    const toggle = screen.getByRole("button", { name: "Afficher les documents de boutique" });
    expect(screen.queryByRole("link", { name: "Catalogue" })).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByRole("link", { name: "Catalogue" })).toBeInTheDocument();
    expect(screen.queryByText("Autres")).toBeNull();
  });

  it("shows no Modules section when no module has anything to configure", async () => {
    vi.spyOn(serversApi, "listServers").mockResolvedValue([]);
    render(<ProjectSidebar />);
    await screen.findByText(/Nouveau module/i);
    expect(screen.queryByText(/Modules installés/i)).toBeNull();
  });

  it("renders the + Nouveau workspace link", async () => {
    vi.spyOn(serversApi, "listServers").mockResolvedValue([]);
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Nouveau module/i)).toBeInTheDocument();
  });

  it("renders the user menu pill (Settings link lives inside its dropdown)", async () => {
    vi.spyOn(serversApi, "listServers").mockResolvedValue([]);
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Anonymous|Anonyme/i)).toBeInTheDocument();
  });

  it("falls back to the persisted server selection on routes without a serverId param", async () => {
    // e.g. /settings or /credits — no serverId in the URL.
    mockParams.current = {};
    useServersStore.setState({ activeServerId: "sk_1" } as any);
    vi.spyOn(serversApi, "listServers").mockResolvedValue([
      srv("sk_1", "Survival"),
      srv("sk_2", "Creatif"),
    ]);
    render(<ProjectSidebar />);
    expect(await screen.findByRole("link", { name: /pack_a/ })).toBeInTheDocument();
    // Still scoped to the persisted server.
    expect(screen.queryByRole("link", { name: /Shop/ })).not.toBeInTheDocument();
  });

  // A persisted server that no longer exists cannot "fall back to another
  // server": a Project belongs to a server and is read from ITS disk
  // (ADR `server-disk-only-storage`). There is nothing to list — the server
  // picker stays there to choose a real one.
  it("a persisted server that vanished lists nothing rather than another server's list", async () => {
    mockParams.current = {};
    useServersStore.setState({ activeServerId: "sk_deleted" } as any);
    vi.mocked(listServerProjects).mockResolvedValueOnce({ ok: false, error: "forbidden" });
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /pack_a|Lobby/ })).toBeNull();
  });

  /**
   * Same requirement as a server page: an empty list asserted while reading, or
   * for an offline server, reads as "this server has nothing" — and the "New
   * project" button then invites writing to a disk that cannot be reached.
   */
  it("says it is reading rather than showing an empty list", async () => {
    vi.mocked(listServerProjects).mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    expect(await screen.findByText("Lecture en cours…")).toBeInTheDocument();
    expect(screen.queryByText("+ Nouveau module")).toBeNull();
  });

  it("says the server is unreachable, and no longer invites creating a project there", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "server_offline" });
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(await screen.findByText("Serveur injoignable")).toBeInTheDocument();
    expect(screen.queryByText("+ Nouveau module")).toBeNull();
  });

  it("brings the create button back once the read has succeeded", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: true, projectIds: ["pack_a"] });
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(await screen.findByText("+ Nouveau module")).toBeInTheDocument();
  });

  it("persists the URL server into the store", async () => {
    mockParams.current = { serverId: "sk_1" };
    vi.spyOn(serversApi, "listServers").mockResolvedValue([srv("sk_1", "Survival")]);
    render(<ProjectSidebar />);
    await waitFor(() => expect(useServersStore.getState().activeServerId).toBe("sk_1"));
  });
});
