import type { Project } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePlaces, ThemeBar } from "./ResourcePlaces";

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
    expect(within(screen.getByTestId("place-theme-ete")).getByText("rangé")).toBeInTheDocument();
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
    fireEvent.click(within(screen.getByTestId("place-module-srv.guilds")).getByText("Guildes"));
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
      within(screen.getByTestId("place-theme-ete")).getByRole("button", {
        name: "Mettre en place",
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
      within(screen.getByTestId("place-theme-noel")).getByRole("button", { name: "Ranger" }),
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
    fireEvent.click(gone.getByRole("button", { name: "Ranger" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server_offline");
  });

  it("says above a theme's Resources whether it is in place, and leads to its page", () => {
    const onSettings = vi.fn();
    const { rerender } = render(<ThemeBar name="noel" onSettings={onSettings} />);
    expect(screen.getByTestId("theme-bar")).toHaveTextContent("Thème « noel »");
    expect(screen.getByText("en place")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aperçu et réglages du thème" }));
    expect(onSettings).toHaveBeenCalledWith("noel");
    rerender(<ThemeBar name="ete" onSettings={onSettings} />);
    expect(screen.getByText("rangé")).toBeInTheDocument();
  });
});
