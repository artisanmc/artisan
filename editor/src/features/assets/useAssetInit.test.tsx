import * as userAssetsApi from "@/lib/api/userAssets";
import { useAuthStore } from "@/state/authStore";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetStore } from "./assetStore";
import { useAssetInit } from "./useAssetInit";

const A1 = {
  id: "asset_1",
  projectId: "p1",
  type: "glyph" as const,
  name: "bg",
  width: 16,
  height: 16,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
};

function Harness({ projectId }: { projectId: string | null }) {
  useAssetInit(projectId as never);
  return null;
}

describe("useAssetInit", () => {
  afterEach(async () => {
    await vi.dynamicImportSettled();
  });
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    vi.restoreAllMocks();
  });

  it("fetches assets on mount and populates the store", async () => {
    const spy = vi.spyOn(userAssetsApi, "listAssets").mockResolvedValue([A1]);
    render(<Harness projectId="p1" />);
    expect(useAssetStore.getState().loading).toBe(true);
    // Flush the resolved promise chain.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("p1");
    expect(useAssetStore.getState().assets).toHaveLength(1);
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_1");
    expect(useAssetStore.getState().loading).toBe(false);
  });

  it("does not fetch when no user is signed in", () => {
    useAuthStore.setState({ currentUser: null } as never);
    const spy = vi.spyOn(userAssetsApi, "listAssets").mockResolvedValue([]);
    render(<Harness projectId="p1" />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not fetch when projectId is null (clears assets instead)", () => {
    useAssetStore.getState().setAssets([A1]);
    const spy = vi.spyOn(userAssetsApi, "listAssets").mockResolvedValue([]);
    render(<Harness projectId={null} />);
    expect(spy).not.toHaveBeenCalled();
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("writes the error message to the store when the fetch rejects", async () => {
    vi.spyOn(userAssetsApi, "listAssets").mockRejectedValue(new Error("boom"));
    render(<Harness projectId="p1" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAssetStore.getState().error).toBe("boom");
    expect(useAssetStore.getState().loading).toBe(false);
  });
});
