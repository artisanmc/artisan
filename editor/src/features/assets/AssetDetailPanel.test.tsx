import type { Asset } from "@/domain/asset";
import * as templatesApi from "@/lib/api/templates";
import * as userAssetsApi from "@/lib/api/userAssets";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImage, encodePng } from "@/lib/pack/png";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { useKitStore } from "@/state/kitStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useAssetStore } from "./assetStore";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

const assetBytes = vi.fn(async (): Promise<Uint8Array> => {
  throw new Error("image_unavailable");
});
vi.mock("./assetBytes", () => ({ assetBytes: () => assetBytes() }));

vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

const A: Asset = {
  id: "asset_a",
  projectId: "p1",
  type: "glyph",
  name: "icon",
  width: 8,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
};

describe("AssetDetailPanel", () => {
  it("refreshes classification when the selected image gains another use elsewhere", async () => {
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...A, name: "renamed", usages: ["menu"] });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    act(() => useAssetStore.getState().upsertAsset({ ...A, usages: ["menu"] }));
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText(/^Nom$/), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", A.id, { name: "renamed" }));
  });
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A]);
    useAssetStore.getState().setSelectedId("asset_a");
    useProjectTemplatesStore.setState({ entries: {} });
    useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
    useProjectsStore.setState({ openProjects: { projects: [], projectOrder: [] } });
    mockCurrentUser = { id: "u1" };
    vi.restoreAllMocks();
  });

  it("shows the asset details", () => {
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect((screen.getByLabelText(/^Nom$/i) as HTMLInputElement).value).toBe("icon");
    expect(screen.getByText(/codepoint/i)).toBeTruthy();
    expect(screen.getByText(/U\+E000/)).toBeTruthy();
  });

  it("renames the asset", async () => {
    vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue({ ...A, name: "icon2" });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.change(screen.getByLabelText(/^Nom$/i), { target: { value: "icon2" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => expect(useAssetStore.getState().assets[0]!.name).toBe("icon2"));
  });

  it("deletes the asset with confirmation", async () => {
    const spy = vi.spyOn(userAssetsApi, "deleteAsset").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Supprimer du module/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("p1", "asset_a"));
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("reports a common image that is not at its piece's size, in the common images' Project", () => {
    useKitStore.setState({ read: { projectId: "p1", files: {}, binaries: [], byName: true } });
    const piece = { ...A, id: "button.3x1", name: "button.3x1", type: "texture" as const };
    useAssetStore.getState().setAssets([{ ...piece, width: 60, height: 18 }]);
    useAssetStore.getState().setSelectedId("button.3x1");
    const { unmount } = render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.getByTestId("asset-misfit")).toHaveTextContent(
      "Cette image fait 60 × 18 px, la pièce 54 × 18 px",
    );
    // Artisan's original shows beside it, and deleting the image is restoring the original.
    expect(screen.getByTestId("common-image-original")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurer l'original" })).toBeInTheDocument();
    unmount();
    // At the piece's size it is taken; in any other module the name is an image like another.
    useAssetStore.getState().setAssets([{ ...piece, width: 54, height: 18 }]);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.queryByTestId("asset-misfit")).toBeNull();
    act(() => {
      useKitStore.setState({ read: undefined });
      useAssetStore.getState().setAssets([{ ...piece, width: 60, height: 18 }]);
    });
    expect(screen.getByText("60×18")).toBeInTheDocument();
    expect(screen.queryByTestId("asset-misfit")).toBeNull();
    expect(screen.queryByTestId("common-image-original")).toBeNull();
    expect(screen.getByRole("button", { name: "Supprimer du module" })).toBeInTheDocument();
  });

  it("says the original changed since the owner's version, until they keep theirs", async () => {
    const origin = (hash: string) => ({ module: "artisan", template: "base", version: 1, hash });
    const image = { ...A, id: "frame", name: "frame", type: "texture" as const };
    useAssetStore.getState().setAssets([image]);
    useAssetStore.getState().setSelectedId("frame");
    useProjectsStore.setState({
      openProjects: {
        projects: [{ id: "p1", diskId: "shop", serverKeyId: "srv", documents: {} } as never],
        projectOrder: ["p1" as never],
      },
    });
    const origins = {
      "assets/textures/frame.png": origin("old"),
      "originals/assets/textures/frame.png": origin("new"),
      // Made against the original the module still ships: nothing to say.
      "assets/textures/other.png": origin("same"),
      "originals/assets/textures/other.png": origin("same"),
    };
    useProjectTemplatesStore.setState({
      entries: { p1: { status: "ready", origins, hashes: {} } },
    });
    const keep = vi
      .spyOn(templatesApi, "keepProjectOrigin")
      .mockResolvedValueOnce({ ok: false, error: "plugin_update_required" })
      .mockResolvedValue({ ok: true });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.getByTestId("original-changed")).toHaveTextContent(
      "L'original a changé depuis ta version.",
    );
    // A server too old to record it says so, and the notice stays.
    fireEvent.click(screen.getByRole("button", { name: "Garder la mienne" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mets Artisan à jour sur ce serveur pour garder ta version.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Garder la mienne" }));
    await waitFor(() => expect(screen.queryByTestId("original-changed")).toBeNull());
    expect(keep).toHaveBeenLastCalledWith(
      { serverId: "srv", diskId: "shop" },
      "assets/textures/frame.png",
    );
    expect(useProjectTemplatesStore.getState().entries.p1?.origins).toMatchObject({
      "assets/textures/frame.png": origin("new"),
    });
    // An image whose original did not change, or that has none, says nothing.
    act(() => {
      useAssetStore.getState().setAssets([{ ...image, id: "other", name: "other" }]);
      useAssetStore.getState().setSelectedId("other");
    });
    expect((screen.getByLabelText(/^Nom$/i) as HTMLInputElement).value).toBe("other");
    expect(screen.queryByTestId("original-changed")).toBeNull();
  });

  it("shows a module's original beside the owner's version, and holds nothing of an image as shipped", () => {
    const image = { ...A, id: "frame", name: "frame", type: "texture" as const };
    const shipped = { ...image, id: "banner", name: "banner" };
    useAssetStore.getState().setAssets([image, shipped]);
    useAssetStore.getState().setSelectedId("frame");
    useProjectBaselineStore.setState({
      binaryBaselines: {
        p1: {
          "assets/textures/frame.png": { hash: "mine", size: 1 },
          "originals/assets/textures/frame.png": { hash: "theirs", size: 1 },
          "originals/assets/textures/banner.png": { hash: "b", size: 1 },
        },
      },
    });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    // The owner's version over the module's: the original beside it, deleting restores it.
    expect(screen.getByTestId("module-image-original").querySelector("img")?.src).toContain(
      "/api/v1/projects/p1/binary?path=originals%2Fassets%2Ftextures%2Fframe.png&h=theirs",
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Restaurer l'original" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Supprimer ta version de frame"));
    // As shipped: the owner holds no file, so nothing to rename, classify or delete.
    act(() => useAssetStore.getState().setSelectedId("banner"));
    expect(screen.getByTestId("asset-as-shipped")).toHaveTextContent("Livrée par le module");
    expect(screen.queryByTestId("module-image-original")).toBeNull();
    expect(screen.getByLabelText(/^Nom$/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Supprimer|Restaurer|Enregistrer/ })).toBeNull();
    expect(screen.getByRole("button", { name: /atelier/i })).toBeEnabled();
  });

  it("states an image's function, and reports the owner's version that is not taken", async () => {
    const image = { ...A, id: "frame", name: "frame", type: "texture" as const, width: 24 };
    const glyph = { ...A, id: "coin", name: "coin", ascent: 9 };
    useAssetStore.getState().setAssets([image, glyph]);
    useAssetStore.getState().setSelectedId("frame");
    useProjectBaselineStore.setState({
      baselines: {
        p1: {
          "originals/assets/textures/frame.yml": "function: menu\nwidth: 20\nheight: 9\n",
          "assets/textures/frame.yml": "width: 24\nheight: 9\n",
          "originals/assets/glyphs/coin.yml": "function: glyph\nheight: 9\nascent: 7\n",
          "assets/glyphs/coin.yml": "height: 9\nascent: 9\n",
        },
      },
      binaryBaselines: {
        p1: {
          "assets/textures/frame.png": { hash: "mine", size: 1 },
          "originals/assets/textures/frame.png": { hash: "theirs", size: 1 },
          "assets/glyphs/coin.png": { hash: "c", size: 1 },
          "originals/assets/glyphs/coin.png": { hash: "d", size: 1 },
        },
      },
    });
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...image, function: "hud" });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.getByTestId("asset-not-taken")).toHaveTextContent(
      "Non prise : cette image fait 24 × 9 px, l'original 20 × 9 px.",
    );
    fireEvent.change(screen.getByLabelText(/^Fonction/), { target: { value: "hud" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", "frame", { function: "hud" }));
    await waitFor(() =>
      expect((screen.getByLabelText(/^Fonction/) as HTMLSelectElement).value).toBe("hud"),
    );
    act(() => useAssetStore.getState().setSelectedId("coin"));
    expect(screen.getByTestId("asset-not-taken")).toHaveTextContent(
      "Non prise : ce glyphe a une hauteur de 9 et un ascent de 9, l'original une hauteur de 9 et un ascent de 7.",
    );
  });

  it("says whether an image follows the themes' colours", async () => {
    const image = { ...A, id: "frame", name: "frame", type: "texture" as const };
    useAssetStore.getState().setAssets([image]);
    useAssetStore.getState().setSelectedId("frame");
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...image, ramps: true });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    const box = screen.getByRole("checkbox", { name: "Suit les couleurs des thèmes" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", "frame", { ramps: true }));
    await waitFor(() => expect(box).toBeChecked());
  });

  it("tells the colours of an image that no theme repaints, once it follows the themes", async () => {
    const image = { ...A, id: "frame", name: "frame", type: "texture" as const, ramps: true };
    useAssetStore.getState().setAssets([image]);
    useAssetStore.getState().setSelectedId("frame");
    // The main green of the base, and two colours no ramp has.
    const drawn = createImage(3, 1);
    drawn.data.set([0x3c, 0x85, 0x27, 255, 0x12, 0x34, 0x56, 255, 0xab, 0xcd, 0xef, 255]);
    assetBytes.mockResolvedValue(encodePng(drawn));
    const { unmount } = render(<AssetDetailPanel projectId={"p1" as never} />);
    const off = await screen.findByTestId("off-ramp");
    expect(off).toHaveTextContent("2 couleurs de cette image ne sont pas des couleurs d'Artisan");
    expect(screen.getByLabelText("#123456")).toBeInTheDocument();
    expect(screen.getByLabelText("#abcdef")).toBeInTheDocument();
    // Unticked, nothing is said of its colours.
    fireEvent.click(screen.getByRole("checkbox", { name: "Suit les couleurs des thèmes" }));
    expect(screen.queryByTestId("off-ramp")).toBeNull();
    unmount();

    // An image drawn in Artisan's colours alone is repainted whole.
    const base = createImage(1, 1);
    base.data.set([0x3c, 0x85, 0x27, 255]);
    assetBytes.mockResolvedValue(encodePng(base));
    useAssetStore.getState().setAssets([{ ...image, contentHash: "h2" }]);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(await screen.findByTestId("off-ramp-none")).toHaveTextContent(
      "un thème les repeint toutes",
    );
  });

  it("renders nothing when no asset is selected", () => {
    useAssetStore.getState().setSelectedId(null);
    const { container } = render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(container.firstChild).toBeNull();
  });
  it("classifies one image for both buttons and backgrounds", async () => {
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...A, usages: ["button", "menu"] });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Images de boutons/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Images du menu$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("p1", "asset_a", { usages: ["button", "menu"] }),
    );
  });
});
