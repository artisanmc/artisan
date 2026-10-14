import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserProject } from "./userProjects";

/**
 * Since the switch to "disk only" (ADR `server-disk-only-storage`), this route
 * only serves a Project's **identity** — name, slug, owning server, network.
 * Its content comes from `project_read`, on the server's disk, and has nothing
 * to do here.
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

  it.each(["server_offline", "plugin_update_required"])(
    "surfaces the hub's 503 %s as the error message",
    async (code) => {
      global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: code }), { status: 503 }));
      await expect(loadUserProject("lobby.shop")).rejects.toThrow(code);
    },
  );

  it("sends the server reference and preserves the exact project ID", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ project: { id: "internal", externalId: "My_Project" } })));
    await loadUserProject("My_Project", "survival");
    const url = new URL(vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v1/user/projects/My_Project");
    expect(Object.fromEntries(url.searchParams)).toEqual({ server: "survival" });
  });
});
