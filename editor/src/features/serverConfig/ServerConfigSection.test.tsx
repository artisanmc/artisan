import type { Asset } from "@/domain/asset";
import type { ProjectSummary } from "@/lib/api/networks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerConfigSection } from "./ServerConfigSection";

const api = vi.hoisted(() => ({
  getServerConfig: vi.fn(),
  patchServerConfig: vi.fn(),
  listAssets: vi.fn(),
}));
vi.mock("@/lib/api/serverConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/serverConfig")>()),
  getServerConfig: api.getServerConfig,
  patchServerConfig: api.patchServerConfig,
}));
vi.mock("@/lib/api/userAssets", () => ({ listAssets: api.listAssets }));

const config = {
  language: "en",
  per_player_language: false,
  "resource-pack.send-delay-ticks": 20,
  "resource-pack.container-textures.chest": "",
  "resource-pack.container-textures.hopper": "",
  "resource-pack.container-textures.dispenser": "",
};
const project = { id: "p1", externalId: "ui", name: "ui" } as ProjectSummary;
const image = (name: string, size: number, type: Asset["type"] = "texture") =>
  ({ id: name, name, type, width: size, height: size, projectId: "p1" }) as Asset;

function renderSection() {
  return render(<ServerConfigSection networkId="n1" serverKeyId="s1" projects={[project]} />);
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

  it("saves only the changed keys", async () => {
    api.patchServerConfig.mockResolvedValue({ ...config, language: "fr" });
    renderSection();
    fireEvent.change(await screen.findByLabelText("Langue"), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText(/Délai d'envoi/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(api.patchServerConfig).toHaveBeenCalledWith("n1", "s1", {
        language: "fr",
        "resource-pack.send-delay-ticks": 40,
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
      expect(api.patchServerConfig).toHaveBeenCalledWith("n1", "s1", {
        "resource-pack.container-textures.chest": "ui:chest_hd",
      }),
    );
  });

  it("explains the plugin's refusal with the field's label", async () => {
    const { ServerConfigError } = await import("@/lib/api/serverConfig");
    api.patchServerConfig.mockRejectedValue(
      new ServerConfigError("invalid_config", "resource-pack.send-delay-ticks: unsafe_path"),
    );
    renderSection();
    fireEvent.change(await screen.findByLabelText("Langue"), { target: { value: "xx" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(
      await screen.findByText(
        "Délai d'envoi (ticks) : le chemin doit rester dans le dossier du serveur.",
      ),
    ).toBeInTheDocument();
  });

  it("names assistant source fields by source and field", async () => {
    api.getServerConfig.mockResolvedValue({
      config: { "assistant.import-sources.zmenu.path": "plugins/zMenu/menus" },
      online: true,
    });
    renderSection();
    expect(await screen.findByLabelText("zmenu · Dossier")).toBeInTheDocument();
  });
});
