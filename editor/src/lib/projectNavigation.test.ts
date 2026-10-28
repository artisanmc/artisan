import { describe, expect, it } from "vitest";
import { documentDestination, projectDestination, screenDestination } from "./projectNavigation";

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

describe("screenDestination", () => {
  const folder = { id: "internal", externalId: "boutique_addon" };

  it("opens a screen of a listed folder inside it", () => {
    expect(
      screenDestination({ id: "boutique:settings", projectId: "boutique_addon" }, "s", [folder]),
    ).toEqual({
      to: "/servers/$serverId/projects/$projectId/screen/$screenId",
      params: { serverId: "s", projectId: "boutique_addon", screenId: "boutique:settings" },
    });
  });

  it("keeps the standalone screen for a root no listed folder holds (a configuration root)", () => {
    expect(
      screenDestination({ id: "daily:rewards", projectId: "daily_config" }, "s", [folder]),
    ).toEqual({
      to: "/servers/$serverId/screens/$screenId",
      params: { serverId: "s", screenId: "daily:rewards" },
    });
  });
});
