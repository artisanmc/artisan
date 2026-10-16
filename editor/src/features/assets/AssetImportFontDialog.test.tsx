import * as userAssetsApi from "@/lib/api/userAssets";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { useAssetStore } from "./assetStore";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

const fakeAsset = {
  id: "asset_font_1",
  projectId: "p1",
  type: "font" as const,
  name: "my_font",
  width: 0,
  height: 0,
  ascent: null,
  codepoint: null,
  fontMeta: {
    namespace: "my_font",
    glyphMap: [],
  },
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
};

describe("AssetImportFontDialog", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    mockCurrentUser = { id: "u1" };
    vi.restoreAllMocks();
  });

  it("renders the dialog when open=true", () => {
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={() => {}} />);
    expect(screen.getByText(/import mcfonts zip/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /import/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("defaults the name from the filename, stripping the extension and normalizing", () => {
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={() => {}} />);
    // Spaces and dots are illegal under [a-z0-9_-]+ and must be replaced with _.
    // Hyphens and underscores are allowed and preserved as-is.
    const file = new File([new Uint8Array([1, 2, 3])], "My Font.v2.zip", {
      type: "application/zip",
    });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("my_font_v2");
    expect(screen.getByText(/ready to import/i)).toBeTruthy();
  });

  it("preserves hyphens and digits in the normalized name", () => {
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={() => {}} />);
    const file = new File([new Uint8Array([1])], "My-Font-2.ZIP", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("my-font-2");
  });

  it("calls uploadFontAsset with the projectId and name on Import", async () => {
    const spy = vi.spyOn(userAssetsApi, "uploadFontAsset").mockResolvedValue({ asset: fakeAsset });
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={() => {}} />);

    const file = new File([new Uint8Array([1, 2, 3])], "my_font.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toBe("p1");
    expect(spy.mock.calls[0]?.[1].name).toBe("my_font");
    expect(spy.mock.calls[0]?.[1].file).toBe(file);
  });

  it("adds the asset to the store and closes on success", async () => {
    vi.spyOn(userAssetsApi, "uploadFontAsset").mockResolvedValue({ asset: fakeAsset });
    const onClose = vi.fn();
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={onClose} />);

    const file = new File([new Uint8Array([1])], "my_font.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_font_1");
  });

  it("displays the error and stays open if the upload fails", async () => {
    vi.spyOn(userAssetsApi, "uploadFontAsset").mockRejectedValue(new Error("Bad zip"));
    const onClose = vi.fn();
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={onClose} />);

    const file = new File([new Uint8Array([1])], "broken.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(screen.getByText(/bad zip/i)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces warnings from the backend in the UI", async () => {
    vi.useFakeTimers();
    vi.spyOn(userAssetsApi, "uploadFontAsset").mockResolvedValue({
      asset: fakeAsset,
      warnings: ["skipped malformed glyph X"],
    });
    const onClose = vi.fn();
    render(<AssetImportFontDialog projectId={"p1" as never} open onClose={onClose} />);

    const file = new File([new Uint8Array([1])], "my_font.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/zip file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await vi.waitFor(() => expect(screen.getByText(/skipped malformed glyph X/i)).toBeTruthy());
    // Asset is still upserted immediately.
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_font_1");
    vi.useRealTimers();
  });
});
