import * as userAssetsApi from "@/lib/api/userAssets";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

describe("AssetUploadDialog", () => {
  it("preselects the context role and lets an image have multiple uses", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockResolvedValue({ id: "bg", projectId: "p1" } as never);
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} usage="menu" />);
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Images de boutons/ }));
    fireEvent.change(screen.getByLabelText(/fichier/i), {
      target: { files: [new File(["png"], "bg.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Importer$/ }));
    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ usages: ["button", "menu"] }),
      ),
    );
  });
  beforeEach(() => {
    useAssetStore.getState().reset();
    mockCurrentUser = { id: "u1" };
    vi.restoreAllMocks();
  });

  it("uploads as glyph (no type selector exposed) and upserts the result", async () => {
    const fakeAsset = {
      id: "asset_x",
      projectId: "p1",
      type: "glyph" as const,
      name: "tex",
      width: 16,
      height: 16,
      ascent: 7,
      codepoint: 0xe000,
      fontMeta: null,
      contentHash: "h",
      createdAt: "",
      updatedAt: "",
    };
    const spy = vi.spyOn(userAssetsApi, "uploadAsset").mockResolvedValue(fakeAsset);
    const onClose = vi.fn();

    render(<AssetUploadDialog projectId={"p1" as never} open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: "tex" } });
    const file = new File([new Uint8Array([1, 2, 3])], "tex.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /importer/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Every upload routes through the `glyph` codepath — the user no longer
    // picks between texture/glyph.
    expect(spy.mock.calls[0]?.[1]?.type).toBe("glyph");
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_x");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error if upload fails", async () => {
    vi.spyOn(userAssetsApi, "uploadAsset").mockRejectedValue(
      new Error("Asset name already exists"),
    );
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: "x" } });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /importer/i }));
    await waitFor(() => expect(screen.getByText(/Asset name already exists/i)).toBeTruthy());
  });

  it("does not expose the texture/glyph type selector to the user", () => {
    // The user should think "upload an image" — internal `asset.type` is
    // not part of the UI surface area.
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} />);
    expect(screen.queryByLabelText(/^texture$/i)).toBeNull();
    expect(screen.queryByLabelText(/^glyph$/i)).toBeNull();
    // Ascent has likewise disappeared (was gated on type=glyph).
    expect(screen.queryByLabelText(/ascent/i)).toBeNull();
  });

  it("names the asset after the chosen file", () => {
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} />);
    const file = new File([new Uint8Array([1])], "Mon Icône 2.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    expect((screen.getByLabelText(/^nom/i) as HTMLInputElement).value).toBe("mon_icone_2");
  });

  it("keeps a name the user typed when a file is chosen", () => {
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: "coin" } });
    const file = new File([new Uint8Array([1])], "other.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    expect((screen.getByLabelText(/^nom/i) as HTMLInputElement).value).toBe("coin");
  });

  it("hands the uploaded asset to onUploaded", async () => {
    const fakeAsset = {
      id: "coin",
      projectId: "p1",
      type: "glyph" as const,
      name: "coin",
      width: 16,
      height: 16,
      ascent: 7,
      codepoint: 0xe000,
      fontMeta: null,
      contentHash: "h",
      createdAt: "",
      updatedAt: "",
    };
    vi.spyOn(userAssetsApi, "uploadAsset").mockResolvedValue(fakeAsset);
    const onUploaded = vi.fn();
    render(
      <AssetUploadDialog
        projectId={"p1" as never}
        open
        onClose={() => {}}
        onUploaded={onUploaded}
      />,
    );
    const file = new File([new Uint8Array([1])], "coin.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /importer/i }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(fakeAsset));
  });
});
