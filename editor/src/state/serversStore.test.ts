import { describe, expect, it } from "vitest";
import { useServersStore } from "./serversStore";

describe("useServersStore", () => {
  it("starts with null and updates via setActiveServerId", () => {
    useServersStore.getState().reset();
    expect(useServersStore.getState().activeServerId).toBeNull();
    useServersStore.getState().setActiveServerId("sk_1");
    expect(useServersStore.getState().activeServerId).toBe("sk_1");
  });
});
