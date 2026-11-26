import type { Asset } from "@/domain/asset";
import type { ProjectSummary } from "@/lib/api/servers";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The page gives the inspector's condition editor; these tests do not edit conditions. */
const NoConditions = () => null;
import { ServerConfigSection } from "./ServerConfigSection";

const api = vi.hoisted(() => ({
  getServerConfig: vi.fn(),
  patchServerConfig: vi.fn(),
  listAssets: vi.fn(),
  readProject: vi.fn(),
}));
vi.mock("@/lib/api/serverConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/serverConfig")>()),
  getServerConfig: api.getServerConfig,
  patchServerConfig: api.patchServerConfig,
}));
vi.mock("@/lib/api/userAssets", () => ({ listAssets: api.listAssets }));
vi.mock("@/lib/projectClient", () => ({ projectClient: () => ({ read: api.readProject }) }));

const config = {
  language: "en",
  per_player_language: false,
  "resource-pack.delegate-to-dir": "",
  "resource-pack.container-textures.chest": "",
  "resource-pack.container-textures.hopper": "",
  "resource-pack.container-textures.dispenser": "",
};
const project = { id: "p1", externalId: "ui", name: "ui" } as ProjectSummary;
const image = (name: string, size: number, type: Asset["type"] = "texture") =>
  ({ id: name, name, type, width: size, height: size, projectId: "p1" }) as Asset;

function renderSection() {
  return render(
    <ServerConfigSection serverKeyId="s1" projects={[project]} conditionsField={NoConditions} />,
  );
}

describe("ServerConfigSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getServerConfig.mockResolvedValue({ config, online: true });
    api.listAssets.mockResolvedValue([
      image("chest_hd", 512),
      image("icon", 16),
      image("font", 256, "font"),
    ]);
  });

  it("says so when the server has not reported its config", async () => {
    api.getServerConfig.mockResolvedValue({ config: null, online: false });
    renderSection();
    expect(await screen.findByText(/connecté/)).toBeInTheDocument();
  });

  it("counts the pending changes, and discards them", async () => {
    renderSection();
    const language = await screen.findByLabelText("Langue");
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    fireEvent.change(language, { target: { value: "fr" } });
    expect(screen.getByText("1 réglage modifié")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(language).toHaveValue("en");
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  });

  it("saves only the changed keys", async () => {
    api.patchServerConfig.mockResolvedValue({ ...config, language: "fr" });
    renderSection();
    fireEvent.change(await screen.findByLabelText("Langue"), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText(/Dossier du pack/), {
      target: { value: "plugins/Nexo/pack" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", {
        language: "fr",
        "resource-pack.delegate-to-dir": "plugins/Nexo/pack",
      }),
    );
  });

  it("offers the server's images in the vanilla layout as container textures", async () => {
    renderSection();
    const chest = await screen.findByLabelText(/^Coffres/);
    await waitFor(() =>
      expect(screen.getAllByRole("option", { name: "ui:chest_hd" })).toHaveLength(3),
    );
    expect(screen.queryByRole("option", { name: "ui:icon" })).toBeNull();
    expect(screen.queryByRole("option", { name: "ui:font" })).toBeNull();
    fireEvent.change(chest, { target: { value: "ui:chest_hd" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", {
        "resource-pack.container-textures.chest": "ui:chest_hd",
      }),
    );
  });

  it("offers the themes of the common images, and the one in place even when it is gone", async () => {
    api.getServerConfig.mockResolvedValue({
      config: { ...config, "resource-pack.theme": "paques" },
      online: true,
    });
    api.readProject.mockResolvedValue({
      ok: true,
      files: { "menus/shop.yml": "" },
      binaries: [
        { path: "themes/noel/assets/textures/close.1x1.png", hash: "h" },
        { path: "themes/halloween/assets/textures/button.3x1.png", hash: "h" },
      ],
    });
    api.patchServerConfig.mockImplementation(async (_id, changes) => ({ ...config, ...changes }));
    const kit = { id: "p2", externalId: "ui-kit", name: "ui-kit" } as ProjectSummary;
    render(
      <ServerConfigSection
        serverKeyId="s1"
        projects={[project, kit]}
        conditionsField={NoConditions}
      />,
    );
    const theme = await screen.findByLabelText(/^Thème des images communes/);
    await waitFor(() => expect(screen.getByRole("option", { name: "noel" })).toBeInTheDocument());
    expect([...theme.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Aucun thème",
      "halloween",
      "noel",
      "paques",
    ]);
    fireEvent.change(theme, { target: { value: "noel" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", { "resource-pack.theme": "noel" }),
    );
  });

  it("edits the themes in place as an ordered list, and names the server's themes", async () => {
    api.getServerConfig.mockResolvedValue({
      config: { ...config, "resource-pack.themes": ["noel"], "resource-pack.theme": "noel" },
      online: true,
    });
    api.readProject.mockResolvedValue({
      ok: true,
      files: {},
      binaries: [
        { path: "themes/noel/assets/textures/close.1x1.png", hash: "h" },
        { path: "themes/nuit/assets/textures/close.1x1.png", hash: "h" },
      ],
    });
    api.patchServerConfig.mockImplementation(async (_id, changes) => ({ ...config, ...changes }));
    const kit = { id: "p2", externalId: "ui-kit", name: "ui-kit" } as ProjectSummary;
    // A theme of its own folder is a Project of the server with the role `theme`.
    const automne = { id: "p3", externalId: "automne", name: "automne", role: "theme" };
    render(
      <ServerConfigSection
        serverKeyId="s1"
        projects={[project, kit, automne as ProjectSummary]}
        conditionsField={NoConditions}
      />,
    );
    const themes = await screen.findByLabelText(/^Thèmes en place/);
    expect(themes).toHaveValue("noel");
    // The former single theme, which the server still reports, is not offered beside the list.
    expect(screen.queryByLabelText(/^Thème des images communes/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByText(/Thèmes du serveur : automne, noel, nuit/)).toBeInTheDocument(),
    );
    fireEvent.change(themes, { target: { value: "noel, nuit" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", {
        "resource-pack.themes": ["noel", "nuit"],
      }),
    );
  });

  it("explains the plugin's refusal with the field's label", async () => {
    const { ApiError } = await import("@/lib/api/client");
    api.patchServerConfig.mockRejectedValue(
      new ApiError("invalid_config", 422, null, "resource-pack.delegate-to-dir: unsafe_path"),
    );
    renderSection();
    fireEvent.change(await screen.findByLabelText("Langue"), { target: { value: "xx" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(
      await screen.findByText(
        "Dossier du pack de Nexo, Oraxen ou ItemsAdder (chemin) : le chemin doit rester dans le dossier du serveur.",
      ),
    ).toBeInTheDocument();
  });

  it("edits the server's text palette as named colors and gradients", async () => {
    api.getServerConfig.mockResolvedValue({
      config: {
        ...config,
        "text-palette.colors": ["Brand #ff6b35"],
        "text-palette.gradients": ["Sunset #ff5f6d #ffc371"],
      },
      online: true,
    });
    api.patchServerConfig.mockImplementation(async (_id, changes) => ({ ...config, ...changes }));
    renderSection();
    expect(await screen.findByText("Palette de texte", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Brand")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sunset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une couleur" }));
    fireEvent.change(screen.getAllByLabelText("Nom")[1]!, { target: { value: "Gold" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", {
        "text-palette.colors": ["Brand #ff6b35", "Gold #5ab4ff"],
      }),
    );
  });

  it("edits the server's menu variants as a list, and holds back a wrong one", async () => {
    api.getServerConfig.mockResolvedValue({
      config: { ...config, "menu-variants": [] },
      online: true,
    });
    api.patchServerConfig.mockResolvedValue({ ...config, "menu-variants": [{ name: "large" }] });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Ajouter une variante/ }));
    const name = screen.getByLabelText("Nom");
    fireEvent.change(name, { target: { value: "textured" } });
    expect(screen.getByText(/Nom intégré/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "large" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("s1", {
        "menu-variants": [{ name: "large" }],
      }),
    );
  });
});
