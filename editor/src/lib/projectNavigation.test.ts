import { describe, expect, it } from "vitest";
import { projectDestination } from "./projectNavigation";

describe("project URLs", () => {
  it("uses the exact module identity, including document links", () => {
    const project = { id: "internal-stable", externalId: "boutique_addon", slug: "boutique-shop" };
    expect(projectDestination("network", project, "server", "menu").params).toEqual({
      networkId: "network",
      serverId: "server",
      projectId: "boutique_addon",
      documentId: "menu",
    });
  });
  it("keeps the demo scope with its folder ID; a Network alone leads back to the Network", () => {
    expect(projectDestination("network", { id: "internal", externalId: "My_Project" })).toEqual({
      to: "/networks/$networkId",
      params: { networkId: "network" },
    });
    expect(
      projectDestination(null, { id: "guest-internal", externalId: "demo" }).params.projectId,
    ).toBe("demo");
  });
});
