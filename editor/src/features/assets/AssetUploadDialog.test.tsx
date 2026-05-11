import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";
import * as packApi from "@/lib/packApi";

vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: (s: { accessToken: string | null }) => unknown) =>
    sel({ accessToken: "tok_test" }),
}));

describe("AssetUploadDialog", () => {
  beforeEach(() => useAssetStore.getState().reset());

  it("uploads a texture and upserts the result into the store", async () => {
    const fakeAsset = {
      id: "asset_x", serverKeyId: "sk", type: "texture" as const, name: "tex",
      width: 16, height: 16, ascent: null, codepoint: null, fontMeta: null,
      contentHash: "h", createdAt: "", updatedAt: "",
    };
    const spy = vi.spyOn(packApi, "uploadAsset").mockResolvedValue(fakeAsset);
    const onClose = vi.fn();

    render(<AssetUploadDialog open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "tex" } });
    const file = new File([new Uint8Array([1, 2, 3])], "tex.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_x");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error if upload fails", async () => {
    vi.spyOn(packApi, "uploadAsset").mockRejectedValue(new Error("Asset name already exists"));
    render(<AssetUploadDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "x" } });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() => expect(screen.getByText(/Asset name already exists/i)).toBeTruthy());
  });

  it("shows ascent input only when type=glyph", () => {
    render(<AssetUploadDialog open onClose={() => {}} />);
    expect(screen.queryByLabelText(/ascent/i)).toBeNull();
    fireEvent.click(screen.getByLabelText(/glyph/i));
    expect(screen.getByLabelText(/ascent/i)).toBeTruthy();
  });
});
