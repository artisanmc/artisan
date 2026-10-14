import { describe, expect, it } from "vitest";
import { documentDestination, projectDestination } from "./projectNavigation";

describe("documentDestination — following a document reference", () => {
  const core = { id: "internal-1", diskId: "core" };

  it("opens a bare id in the current project", () => {
    expect(documentDestination(core, "s", "main").params).toMatchObject({
      projectId: "core",
      documentId: "main",
    });
  });

  it("opens a qualified id in the project it names", () => {
    expect(documentDestination(core, "s", "boutique:main").params).toMatchObject({
      projectId: "boutique",
      documentId: "main",
    });
  });

  it("keeps a qualified id that names the current project inside it", () => {
    expect(documentDestination(core, "s", "core:main").params).toMatchObject({
      projectId: "core",
      documentId: "main",
    });
  });
});

describe("project URLs", () => {
  it("uses the exact module identity, including document links", () => {
    const project = { id: "internal-stable", externalId: "boutique_addon", slug: "boutique-shop" };
    expect(projectDestination(project, "server", "menu").params).toEqual({
      serverId: "server",
      projectId: "boutique_addon",
      documentId: "menu",
    });
  });
  it("without a server, leads back to the server list", () => {
    expect(projectDestination({ id: "internal", externalId: "My_Project" })).toEqual({
      to: "/servers",
    });
  });
});
