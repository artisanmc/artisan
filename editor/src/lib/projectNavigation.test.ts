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
  it("keeps hosted and demo location scopes with their folder ID", () => {
    expect(
      projectDestination("network", { id: "internal", externalId: "My_Project" }).params.projectId,
    ).toBe("My_Project");
    expect(
      projectDestination(null, { id: "guest-internal", externalId: "demo" }).params.projectId,
    ).toBe("demo");
  });
});
