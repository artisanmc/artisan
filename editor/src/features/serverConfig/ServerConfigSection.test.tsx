import type { Asset } from "@/domain/asset";
import type { ProjectSummary } from "@/lib/api/servers";
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
  "resource-pack.delegate-to-dir": "",
  "resource-pack.container-textures.chest": "",
  "resource-pack.container-textures.hopper": "",
  "resource-pack.container-textures.dispenser": "",
};
const project = { id: "p1", externalId: "ui", name: "ui" } as ProjectSummary;
const image = (name: string, size: number, type: Asset["type"] = "texture") =>
  ({ id: name, name, type, width: size, height: size, projectId: "p1" }) as Asset;

function renderSection() {
  return render(<ServerConfigSection serverKeyId="s1" projects={[project]} />);
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
});
