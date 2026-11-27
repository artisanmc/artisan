import * as userAssetsApi from "@/lib/api/userAssets";
import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";
import * as libraryDraft from "./libraryDraft";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

describe("AssetUploadDialog", () => {
  it("files the image under the use it is imported for, with nothing to tick", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockResolvedValue({ id: "bg", projectId: "p1" } as never);
    render(<AssetUploadDialog projectId={"p1" as never} open onClose={() => {}} usage="menu" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText(/fichier/i), {
      target: { files: [new File(["png"], "bg.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Importer$/ }));
    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith("p1", expect.objectContaining({ usages: ["menu"] })),
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

describe("AssetUploadDialog, for a menu to name", () => {
  const library = { projectId: "srv.artisan", files: {}, binaries: [], byName: true };
  const pick = (name: string) => {
    fireEvent.change(screen.getByLabelText(/fichier/i), {
      target: { files: [new File(["png"], `${name}.png`, { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Importer$/ }));
  };
  beforeEach(() => {
    useAssetStore.getState().reset();
    vi.restoreAllMocks();
    useKitStore.setState({ read: library, own: {} });
    vi.spyOn(libraryDraft, "openLibraryDraft").mockResolvedValue();
  });

  it("leaves the image in the module when the library's draft cannot be opened", async () => {
    vi.spyOn(libraryDraft, "openLibraryDraft").mockRejectedValue(new Error("draft_unavailable"));
    const add = vi.spyOn(libraryDraft, "addToLibrary");
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockResolvedValue({ id: "crest", projectId: "srv.shop" } as never);
    render(<AssetUploadDialog projectId={"srv.shop" as never} open onClose={() => {}} toLibrary />);
    pick("crest");
    await waitFor(() => expect(upload).toHaveBeenCalledWith("srv.shop", expect.anything()));
    expect(add).not.toHaveBeenCalled();
  });
  afterEach(() => useKitStore.setState({ read: undefined, own: {} }));

  it("writes the image into the server's library and hands it over as a common image", async () => {
    const upload = vi.spyOn(userAssetsApi, "uploadAsset");
    const add = vi.spyOn(libraryDraft, "addToLibrary").mockResolvedValue({
      id: "crest",
      projectId: "srv.artisan",
      type: "glyph",
      name: "crest",
      width: 40,
      height: 12,
      contentHash: "h",
      previewUrl: "blob:crest",
    } as never);
    const onUploaded = vi.fn();
    render(
      <AssetUploadDialog
        projectId={"srv.shop" as never}
        open
        onClose={() => {}}
        usage="button"
        toLibrary
        onUploaded={onUploaded}
      />,
    );
    expect(screen.getByText(/bibliothèque du serveur/)).toBeTruthy();
    pick("crest");
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      "srv.artisan",
      expect.objectContaining({ name: "crest", usages: ["button"] }),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(onUploaded.mock.calls[0]?.[0]).toMatchObject({
      id: "kit:crest",
      projectId: "artisan",
      width: 40,
      height: 12,
    });
    expect(useAssetStore.getState().assets).toEqual([]);
  });

  it("refuses a name the module holds, which its menus would show instead", async () => {
    const add = vi.spyOn(libraryDraft, "addToLibrary");
    useAssetStore.setState({
      assets: [{ id: "crest", projectId: "srv.shop", name: "crest" } as never],
    });
    render(<AssetUploadDialog projectId={"srv.shop" as never} open onClose={() => {}} toLibrary />);
    pick("crest");
    expect(await screen.findByText(/Ce module a déjà une image de ce nom/)).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("stays in the module on a server without a library a module writes in, and in the library itself", async () => {
    const upload = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockResolvedValue({ id: "crest", projectId: "srv.artisan" } as never);
    const add = vi.spyOn(libraryDraft, "addToLibrary");
    render(
      <AssetUploadDialog projectId={"srv.artisan" as never} open onClose={() => {}} toLibrary />,
    );
    pick("crest");
    await waitFor(() => expect(upload).toHaveBeenCalledWith("srv.artisan", expect.anything()));
    expect(add).not.toHaveBeenCalled();
  });
});
