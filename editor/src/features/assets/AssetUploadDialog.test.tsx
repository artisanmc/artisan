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

  it("uploads as glyph (no type selector exposed) and upserts the result", async () => {
    const fakeAsset = {
      id: "asset_x", packId: "p1", type: "glyph" as const, name: "tex",
      width: 16, height: 16, ascent: 7, codepoint: 0xe000, fontMeta: null,
      contentHash: "h", createdAt: "", updatedAt: "",
    };
    const spy = vi.spyOn(packApi, "uploadAsset").mockResolvedValue(fakeAsset);
    const onClose = vi.fn();

    render(<AssetUploadDialog packId={"p1" as never} open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "tex" } });
    const file = new File([new Uint8Array([1, 2, 3])], "tex.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Every upload routes through the `glyph` codepath — the user no longer
    // picks between texture/glyph.
    expect(spy.mock.calls[0]?.[2]?.type).toBe("glyph");
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_x");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error if upload fails", async () => {
    vi.spyOn(packApi, "uploadAsset").mockRejectedValue(new Error("Asset name already exists"));
    render(<AssetUploadDialog packId={"p1" as never} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "x" } });
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() => expect(screen.getByText(/Asset name already exists/i)).toBeTruthy());
  });

  it("does not expose the texture/glyph type selector to the user", () => {
    // The user should think "upload an image" — internal `asset.type` is
    // not part of the UI surface area.
    render(<AssetUploadDialog packId={"p1" as never} open onClose={() => {}} />);
    expect(screen.queryByLabelText(/texture/i)).toBeNull();
    expect(screen.queryByLabelText(/^glyph$/i)).toBeNull();
    // Ascent has likewise disappeared (was gated on type=glyph).
    expect(screen.queryByLabelText(/ascent/i)).toBeNull();
  });
});
