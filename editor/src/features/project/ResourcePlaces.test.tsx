import type { Project } from "@/domain/types";
import { useResourcesView } from "@/features/assets/resourcesView";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePlaces, moduleLabels } from "./ResourcePlaces";

const api = vi.hoisted(() => ({ patchServerConfig: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/api/serverConfig", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  patchServerConfig: api.patchServerConfig,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => api.navigate,
}));
vi.mock("./resourcePackSync", () => ({ rebuildServerPackInBackground: vi.fn() }));
vi.mock("@/features/assets/NewThemeDialog", () => ({ NewThemeDialog: () => null }));
vi.mock("@/features/import/ImportThemeDialog", () => ({ ImportThemeDialog: () => null }));

const project = (id: string, name: string) => ({ id, name }) as unknown as Project;
const theme = (projectId: string, images: string[]) => ({
  projectId,
  files: {},
  binaries: images.map((name) => ({ path: `overrides/artisan/${name}.png`, hash: `h-${name}` })),
});

describe("ResourcePlaces", () => {
  beforeEach(() => {
    api.patchServerConfig.mockReset();
    api.navigate.mockReset();
    useKitStore.setState({
      read: { projectId: "srv.artisan", files: {}, binaries: [] },
      own: {
        noel: theme("srv.noel", ["close.1x1", "button.3x1"]),
        halloween: theme("srv.halloween", ["close.1x1"]),
        ete: theme("srv.ete", []),
      },
      themes: ["halloween", "noel"],
      stacks: true,
    });
    useServerIndexStore.setState({
      projects: [
        project("srv.artisan", "artisan"),
        project("srv.noel", "noel"),
        project("srv.halloween", "halloween"),
        project("srv.ete", "ete"),
        project("srv.shop", "Boutique"),
        project("srv.guilds", "Guildes"),
      ],
    });
  });

  it("lists the places in the order a name is looked up: themes from the highest, the base, then modules", () => {
    render(<ResourcePlaces serverId="s" serverKeyId="key" selected={{ kind: "server" }} />);
    const themes = within(screen.getByTestId("places-themes"));
    expect(themes.getAllByTestId(/^place-/).map((row) => row.getAttribute("data-testid"))).toEqual([
      "place-theme-noel",
      "place-theme-halloween",
      "place-server",
      "place-theme-ete",
    ]);
    expect(
      within(screen.getByTestId("place-theme-noel")).getByText("2 images"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("place-theme-ete")).getByRole("switch", {
        name: "Activer le thème ete",
      }),
    ).toHaveAttribute("aria-checked", "false");
    // The explanations are tooltips beside the titles, not paragraphs under them.
    expect(screen.queryByText(/de haut en bas/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /premier thème actif qui redessine/ }),
    ).toBeInTheDocument();
    // A theme and the server's own theme are no module.
    const modules = within(screen.getByTestId("places-modules"));
    expect(modules.getAllByTestId(/^place-/).map((row) => row.textContent)).toEqual([
      "Boutique",
      "Guildes",
    ]);
    // Artisan's images and the server's are one place.
    expect(screen.queryByTestId("places-base")).toBeNull();
    expect(screen.getByTestId("place-server")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("place-server")).toHaveTextContent("Base");
  });

  it("opens a theme, a module and the server's theme in their Project, a theme the common images keep on its page", async () => {
    render(
      <ResourcePlaces
        serverId="s"
        serverKeyId="key"
        selected={{ kind: "module", id: "srv.shop" }}
      />,
    );
    expect(screen.getByTestId("place-module-srv.shop")).toHaveAttribute("aria-current", "true");
    // A theme of its own folder is edited in its Project, like a module.
    fireEvent.click(within(screen.getByTestId("place-theme-noel")).getByText("noel"));
    expect(api.navigate).toHaveBeenLastCalledWith({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId: "s", projectId: "srv.noel" },
      search: { tab: "resources" },
    });
    // One page per theme: its Resources, open on its overview.
    expect(useResourcesView.getState().view).toBe("theme");
    fireEvent.click(within(screen.getByTestId("place-module-srv.guilds")).getByText("Guildes"));
    expect(useResourcesView.getState().view).toBe("files");
    expect(api.navigate).toHaveBeenLastCalledWith({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId: "s", projectId: "srv.guilds" },
      search: { tab: "resources" },
    });
    fireEvent.click(within(screen.getByTestId("place-server")).getByText("Base"));
    expect(api.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { serverId: "s", projectId: "srv.artisan" } }),
    );
    // A theme the common images' Project still keeps has no Project of its own: its page.
    useKitStore.setState({
      read: {
        projectId: "srv.artisan",
        files: {},
        binaries: [{ path: "themes/hiver/assets/textures/close.1x1.png", hash: "h" }],
      },
    });
    fireEvent.click(await screen.findByText("hiver"));
    expect(api.navigate).toHaveBeenLastCalledWith({
      to: "/servers/$serverId/resources",
      params: { serverId: "s" },
      search: { theme: "hiver" },
    });
  });

  it("puts a theme in place above the others, and puts one away", async () => {
    api.patchServerConfig.mockImplementation(async (_key: string, patch: object) => patch);
    render(<ResourcePlaces serverId="s" serverKeyId="key" selected={null} />);
    fireEvent.click(
      within(screen.getByTestId("place-theme-ete")).getByRole("switch", {
        name: "Activer le thème ete",
      }),
    );
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenLastCalledWith("key", {
        "resource-pack.themes": ["halloween", "noel", "ete"],
      }),
    );
    await waitFor(() =>
      expect(useKitStore.getState().themes).toEqual(["halloween", "noel", "ete"]),
    );
    fireEvent.click(
      within(screen.getByTestId("place-theme-noel")).getByRole("switch", {
        name: "Désactiver le thème noel",
      }),
    );
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenLastCalledWith("key", {
        "resource-pack.themes": ["halloween", "ete"],
      }),
    );
  });

  it("says of a theme in place that the server does not hold, and of a refusal", async () => {
    useKitStore.setState({ themes: ["gone"] });
    api.patchServerConfig.mockRejectedValue(new Error("server_offline"));
    render(<ResourcePlaces serverId="s" serverKeyId="key" selected={null} />);
    const gone = within(screen.getByTestId("place-theme-gone"));
    expect(gone.getByText("Introuvable")).toBeInTheDocument();
    fireEvent.click(gone.getByRole("switch", { name: "Désactiver le thème gone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server_offline");
  });
});

describe("moduleLabels", () => {
  it("names a plugin's module as the sidebar does, before the admin's folders", () => {
    const project = (id: string, name: string, ownerModule?: string) =>
      ({ id, name, updatedAt: "", ...(ownerModule ? { ownerModule } : {}) }) as never;
    expect(
      moduleLabels(
        [
          project("srv.mine", "mine"),
          project("srv.daily", "daily", "daily_rewards"),
          project("srv.q1", "q1", "quests"),
          project("srv.q2", "q2", "quests"),
        ],
        [],
        [],
      ),
    ).toEqual([
      { id: "srv.daily", label: "Daily rewards" },
      { id: "srv.q1", label: "Quests · q1" },
      { id: "srv.q2", label: "Quests · q2" },
      { id: "srv.mine", label: "mine" },
    ]);
  });
});
