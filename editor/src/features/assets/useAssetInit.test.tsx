import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as packApi from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useAssetStore } from "./assetStore";
import { useAssetInit } from "./useAssetInit";

const A1 = {
  id: "asset_1",
  serverKeyId: "sk",
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

function Harness() {
  useAssetInit();
  return null;
}

describe("useAssetInit", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    useSessionStore.setState({
      accessToken: "tok-init",
      serverKeyId: "sk",
      trustCode: null,
      trusted: true,
    } as never);
    vi.restoreAllMocks();
  });

  it("fetches assets on mount and populates the store", async () => {
    const spy = vi.spyOn(packApi, "listAssets").mockResolvedValue([A1]);
    render(<Harness />);
    // Flush the resolved promise chain.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("tok-init");
    expect(useAssetStore.getState().assets).toHaveLength(1);
    expect(useAssetStore.getState().assets[0]?.id).toBe("asset_1");
  });

  it("does not fetch when no access token is available", () => {
    useSessionStore.setState({
      accessToken: null,
      serverKeyId: null,
      trustCode: null,
      trusted: false,
    } as never);
    const spy = vi.spyOn(packApi, "listAssets").mockResolvedValue([]);
    render(<Harness />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("writes the error message to the store when the fetch rejects", async () => {
    vi.spyOn(packApi, "listAssets").mockRejectedValue(new Error("boom"));
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAssetStore.getState().error).toBe("boom");
  });
});
