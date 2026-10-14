import { describe, expect, it } from "vitest";
import { urlServerId } from "./urlIds";

const SERVERS = [
  { networkId: "net_1", serverId: "srv_1", serverSlug: "survie" },
  { networkId: "net_2", serverId: "srv_2", serverSlug: "survie" },
  { networkId: "net_1", serverId: "srv_3" },
];

describe("urlServerId", () => {
  it("prefers the slug, scoped to the network", () => {
    expect(urlServerId(SERVERS, "net_1", "srv_1")).toBe("survie");
  });

  // The same slug lives in several networks: an unscoped lookup would emit
  // another network's server and land on the wrong page.
  it("never resolves across networks", () => {
    expect(urlServerId(SERVERS, "net_2", "srv_1")).toBe("srv_1");
    expect(urlServerId(SERVERS, "net_2", "srv_2")).toBe("survie");
  });

  it("falls back to the id when the server has no slug or is unknown", () => {
    expect(urlServerId(SERVERS, "net_1", "srv_3")).toBe("srv_3");
    expect(urlServerId([], "net_1", "srv_1")).toBe("srv_1");
    expect(urlServerId(SERVERS, "net_1", null)).toBeNull();
  });

  it("is idempotent — a slug in, the same slug out", () => {
    expect(urlServerId(SERVERS, "net_1", "survie")).toBe("survie");
  });
});
