import { describe, expect, it } from "vitest";
import { documentDestination, projectDestination } from "./projectNavigation";

describe("documentDestination — following a document reference", () => {
  const core = { id: "internal-1", diskId: "core" };

  it("opens a bare id in the current project", () => {
    expect(documentDestination("n", core, "s", "main").params).toMatchObject({
      projectId: "core",
      documentId: "main",
    });
  });

  it("opens a qualified id in the project it names", () => {
    expect(documentDestination("n", core, "s", "boutique:main").params).toMatchObject({
      projectId: "boutique",
      documentId: "main",
    });
  });

  it("keeps a qualified id that names the current project inside it", () => {
    expect(documentDestination("n", core, "s", "core:main").params).toMatchObject({
      projectId: "core",
      documentId: "main",
    });
  });
});

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
