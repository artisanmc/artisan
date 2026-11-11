import { describe, expect, it } from "vitest";
import { urlServerId } from "./urlIds";

const SERVERS = [{ serverId: "srv_1", serverSlug: "survie" }, { serverId: "srv_3" }];

describe("urlServerId", () => {
  it("prefers the slug", () => {
    expect(urlServerId(SERVERS, "srv_1")).toBe("survie");
  });

  it("falls back to the id when the server has no slug or is unknown", () => {
    expect(urlServerId(SERVERS, "srv_3")).toBe("srv_3");
    expect(urlServerId([], "srv_1")).toBe("srv_1");
    expect(urlServerId(SERVERS, null)).toBeNull();
  });

  it("is idempotent — a slug in, the same slug out", () => {
    expect(urlServerId(SERVERS, "survie")).toBe("survie");
  });
});
