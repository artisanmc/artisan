import * as userAssetsApi from "@/lib/api/userAssets";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetImportNexoDialog } from "./AssetImportNexoDialog";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));

const asset = (name: string) =>
  ({
    id: name,
    projectId: "p1",
    type: "glyph",
    name,
    width: 1,
    height: 1,
    ascent: 8,
    codepoint: 0xe000,
    fontMeta: null,
    contentHash: "h",
    createdAt: "",
    updatedAt: "",
  }) as never;

describe("AssetImportNexoDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAssetStore.getState().reset();
    useAssetStore.getState().upsertAsset(asset("shop_bg"));
  });

  it("imports the selected glyphs, replacing the ones already imported", async () => {
    vi.spyOn(userAssetsApi, "listNexoGlyphs").mockResolvedValue([
      { id: "shop_bg", texture: "shop:bg.png", available: true },
      { id: "Coin.Gold", texture: "coin", available: true },
      { id: "ghost", texture: "nowhere", available: false },
    ]);
    vi.spyOn(userAssetsApi, "fetchNexoGlyph").mockResolvedValue(new Blob([new Uint8Array([1])]));
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_p, input) => asset(input.name));
    const onClose = vi.fn();

    render(<AssetImportNexoDialog projectId={"p1" as never} open onClose={onClose} />);

    const ghost = await screen.findByRole("button", { name: /ghost/ });
    expect((ghost as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/mettre à jour/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /shop_bg/ }));
    fireEvent.click(screen.getByRole("button", { name: /Coin\.Gold/ }));
    fireEvent.click(screen.getByRole("button", { name: /importer 2/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ name: "shop_bg", type: "glyph", replace: true }),
    );
    expect(upload).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ name: "coin_gold", replace: false }),
    );
  });

  it("says when the server has no Nexo glyphs", async () => {
    vi.spyOn(userAssetsApi, "listNexoGlyphs").mockResolvedValue([]);
    render(<AssetImportNexoDialog projectId={"p1" as never} open onClose={() => {}} />);
    expect(await screen.findByText(/aucun glyphe nexo/i)).toBeTruthy();
  });
});
