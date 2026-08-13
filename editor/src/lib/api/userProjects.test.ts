import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserProject } from "./userProjects";

/**
 * Depuis la bascule « disque seul » (ADR `server-disk-only-storage`), cette
 * route ne sert plus qu'à l'**identité** d'un Project — nom, slug, serveur
 * propriétaire, network. Son contenu vient de `project_read`, sur le disque du
 * serveur, et n'a plus rien à faire ici.
 */
describe("userProjects API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadUserProject GET /api/v1/user/projects/:projectId returns the project identity", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          project: { id: "p1", name: "Boutique", externalId: "boutique_shop", hash: "h1" },
          networkId: "net_1",
          serverKeyId: "sk_1",
        }),
        { status: 200 },
      ),
    );

    const res = await loadUserProject("p1");

    expect(res.project.id).toBe("p1");
    expect(res.project.externalId).toBe("boutique_shop");
    expect(res.serverKeyId).toBe("sk_1");
  });

  it("throws on a transport failure", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(loadUserProject("p1")).rejects.toThrow();
  });
});
