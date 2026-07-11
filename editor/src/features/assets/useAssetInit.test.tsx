import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as projectApi from "@/lib/projectApi";
import * as userAssetsApi from "@/lib/api/userAssets";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
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
  beforeEach(() => {
    useAssetStore.getState().reset();
    useSessionStore.setState({
      accessToken: "tok-init",
      serverKeyId: "sk",
      trustCode: null,
      trusted: true,
    } as never);
    useAuthStore.setState({ currentUser: null } as never);
    vi.restoreAllMocks();
  });

  it("fetches assets on mount and populates the store", async () => {
    const spy = vi.spyOn(projectApi, "listAssets").mockResolvedValue([A1]);
    render(<Harness projectId="p1" />);
    // Flush the resolved promise chain.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("tok-init", "p1");
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
    const spy = vi.spyOn(projectApi, "listAssets").mockResolvedValue([]);
    render(<Harness projectId="p1" />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not fetch when projectId is null (clears assets instead)", () => {
    useAssetStore.getState().setAssets([A1]);
    const spy = vi.spyOn(projectApi, "listAssets").mockResolvedValue([]);
    render(<Harness projectId={null} />);
    expect(spy).not.toHaveBeenCalled();
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("writes the error message to the store when the fetch rejects", async () => {
    vi.spyOn(projectApi, "listAssets").mockRejectedValue(new Error("boom"));
    render(<Harness projectId="p1" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAssetStore.getState().error).toBe("boom");
  });

  describe("user mode (no session token)", () => {
    beforeEach(() => {
      useSessionStore.setState({
        accessToken: null,
        serverKeyId: null,
        trustCode: null,
        trusted: false,
      } as never);
      useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    });

    it("fetches assets via the user-scoped API when a user is signed in without a session", async () => {
      const sessionSpy = vi.spyOn(projectApi, "listAssets").mockResolvedValue([]);
      const userSpy = vi.spyOn(userAssetsApi, "listAssets").mockResolvedValue([A1]);
      render(<Harness projectId="p1" />);
      await new Promise((r) => setTimeout(r, 0));
      expect(userSpy).toHaveBeenCalledWith("p1");
      expect(sessionSpy).not.toHaveBeenCalled();
      expect(useAssetStore.getState().assets).toHaveLength(1);
    });

    it("does not fetch when neither a token nor a user is present", () => {
      useAuthStore.setState({ currentUser: null } as never);
      const spy = vi.spyOn(userAssetsApi, "listAssets").mockResolvedValue([]);
      render(<Harness projectId="p1" />);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
