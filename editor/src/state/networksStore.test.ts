import { beforeEach, describe, expect, it } from "vitest";
import { useNetworksStore } from "./networksStore";

describe("networksStore", () => {
  beforeEach(() => {
    useNetworksStore.getState().reset();
  });

  it("setNetworks replaces the list", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    expect(useNetworksStore.getState().networks).toHaveLength(1);
  });

  it("upsertNetwork adds or replaces a network", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    useNetworksStore.getState().upsertNetwork({ id: "n1", name: "N1-renamed", tier: "free" });
    expect(useNetworksStore.getState().networks[0].name).toBe("N1-renamed");
    useNetworksStore.getState().upsertNetwork({ id: "n2", name: "N2", tier: "free" });
    expect(useNetworksStore.getState().networks).toHaveLength(2);
  });

  it("reset empties the store", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    useNetworksStore.getState().reset();
    expect(useNetworksStore.getState().networks).toHaveLength(0);
  });

  it("bumpRefresh increments the refresh token", () => {
    expect(useNetworksStore.getState().refreshToken).toBe(0);
    useNetworksStore.getState().bumpRefresh();
    useNetworksStore.getState().bumpRefresh();
    expect(useNetworksStore.getState().refreshToken).toBe(2);
  });

  it("reset clears the refresh token", () => {
    useNetworksStore.getState().bumpRefresh();
    useNetworksStore.getState().reset();
    expect(useNetworksStore.getState().refreshToken).toBe(0);
  });
});
