import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listNetworks,
  createNetwork,
  getNetwork,
  createServerKey,
  createPack,
  bindPackToServerKey,
  unbindPack,
} from "./networks";

describe("networks API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listNetworks GET /api/networks returns list", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          networks: [
            { id: "n1", name: "Network 1", tier: "free" },
          ],
        }),
        { status: 200 }
      )
    );
    const result = await listNetworks();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks$/),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("createNetwork POST /api/networks returns new network", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          network: { id: "n_new", name: "Test Network", tier: "free" },
        }),
        { status: 201 }
      )
    );
    const result = await createNetwork("Test Network");
    expect(result.name).toBe("Test Network");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("getNetwork GET /api/networks/:id returns detail", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          network: { id: "n1", name: "Network 1", tier: "free" },
          packs: [{ id: "p1", name: "pack1", hash: "h1" }],
          serverKeys: [{ id: "sk_1", label: null }],
        }),
        { status: 200 }
      )
    );
    const result = await getNetwork("n1");
    expect(result.network.id).toBe("n1");
    expect(result.packs).toHaveLength(1);
    expect(result.serverKeys).toHaveLength(1);
  });

  it("createServerKey POST /api/networks/:id/server-keys returns key", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "sk_new",
          key: "sk_abc123",
          label: "test-label",
        }),
        { status: 201 }
      )
    );
    const result = await createServerKey("n1", "test-label");
    expect(result.id).toBe("sk_new");
    expect(result.key).toBe("sk_abc123");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks\/n1\/server-keys$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("createPack POST /api/networks/:id/packs returns pack", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          pack: { id: "p_new", name: "new-pack", hash: "h_new" },
        }),
        { status: 201 }
      )
    );
    const result = await createPack("n1", "new-pack");
    expect(result.name).toBe("new-pack");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks\/n1\/packs$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("bindPackToServerKey POST returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await bindPackToServerKey("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks\/n1\/packs\/p1\/bindings\/sk_1$/),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("unbindPack DELETE returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await unbindPack("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/networks\/n1\/packs\/p1\/bindings\/sk_1$/),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
