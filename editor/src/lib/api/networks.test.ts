import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaimError,
  acceptNetworkTransfer,
  bindPackToServerKey,
  claimLinkCode,
  createNetwork,
  createPack,
  createServerKey,
  deleteServerKey,
  getNetwork,
  getNetworkTransfer,
  initNetworkTransfer,
  listNetworks,
  unbindPack,
  updateNetwork,
  updateServerKey,
} from "./networks";

describe("networks API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listNetworks GET /api/v1/networks returns list", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            networks: [{ id: "n1", name: "Network 1", tier: "free" }],
          }),
          { status: 200 },
        ),
    );
    const result = await listNetworks();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("n1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("createNetwork POST /api/v1/networks returns new network", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            network: { id: "n_new", name: "Test Network", tier: "free" },
          }),
          { status: 201 },
        ),
    );
    const result = await createNetwork("Test Network");
    expect(result.name).toBe("Test Network");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("getNetwork GET /api/v1/networks/:id returns detail", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            network: { id: "n1", name: "Network 1", tier: "free" },
            packs: [{ id: "p1", name: "pack1", hash: "h1" }],
            serverKeys: [{ id: "sk_1", label: null }],
          }),
          { status: 200 },
        ),
    );
    const result = await getNetwork("n1");
    expect(result.network.id).toBe("n1");
    expect(result.packs).toHaveLength(1);
    expect(result.serverKeys).toHaveLength(1);
  });

  it("createServerKey POST /api/v1/networks/:id/server-keys returns key", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "sk_new",
            key: "sk_abc123",
            label: "test-label",
          }),
          { status: 201 },
        ),
    );
    const result = await createServerKey("n1", "test-label");
    expect(result.id).toBe("sk_new");
    expect(result.key).toBe("sk_abc123");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/server-keys$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createPack POST /api/v1/networks/:id/packs returns pack", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            pack: { id: "p_new", name: "new-pack", hash: "h_new" },
          }),
          { status: 201 },
        ),
    );
    const result = await createPack("n1", "sk1", "new-pack");
    expect(result.name).toBe("new-pack");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/packs$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("bindPackToServerKey POST returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await bindPackToServerKey("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/packs\/p1\/bindings\/sk_1$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("unbindPack DELETE returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await unbindPack("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/packs\/p1\/bindings\/sk_1$/),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("network transfer API clients", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initNetworkTransfer returns url + expiresAt", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "/transfer?token=t1", expiresAt: "x" }), {
          status: 200,
        }),
    );
    expect(await initNetworkTransfer("net_x")).toEqual({
      url: "/transfer?token=t1",
      expiresAt: "x",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/net_x\/transfer\/init$/),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("getNetworkTransfer returns 'expired' on 410 error=expired", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
    );
    expect(await getNetworkTransfer("tok")).toBe("expired");
  });

  it("getNetworkTransfer returns 'consumed' on 410 error=consumed", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "consumed" }), { status: 410 }),
    );
    expect(await getNetworkTransfer("tok")).toBe("consumed");
  });

  it("getNetworkTransfer returns 'not_found' on 404", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await getNetworkTransfer("tok")).toBe("not_found");
  });

  it("getNetworkTransfer returns full info on 200", async () => {
    const info = {
      networkId: "n1",
      networkName: "Alpha",
      packCount: 2,
      serverKeyCount: 1,
      expiresAt: "x",
    };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(info), { status: 200 }));
    expect(await getNetworkTransfer("tok")).toEqual(info);
  });

  it("acceptNetworkTransfer returns networkId", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, networkId: "n1" }), { status: 200 }),
    );
    expect(await acceptNetworkTransfer("tok")).toEqual({ networkId: "n1" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/transfer\/tok\/accept$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deleteServerKey resolves on success", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(deleteServerKey("net_x", "sk_y")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/net_x\/server-keys\/sk_y$/),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteServerKey throws on failure", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(deleteServerKey("net_x", "sk_y")).rejects.toThrow(
      "Server key delete failed (403)",
    );
  });
});

describe("claimLinkCode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns body on 200", async () => {
    const body = { server_key_id: "sk", network_id: "n1" };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await claimLinkCode("ABC")).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/link\/ABC\/claim$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws ClaimError('must_choose_network') on 400", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "must_choose_network" }), { status: 400 }),
    );
    try {
      await claimLinkCode("ABC");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaimError);
      expect((e as ClaimError).code).toBe("must_choose_network");
    }
  });

  it("throws ClaimError('unauthorized') on 401", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 401 }));
    try {
      await claimLinkCode("ABC");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaimError);
      expect((e as ClaimError).code).toBe("unauthorized");
    }
  });

  it("throws ClaimError('forbidden') on 403", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 403 }));
    try {
      await claimLinkCode("ABC");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaimError);
      expect((e as ClaimError).code).toBe("forbidden");
    }
  });

  it("throws ClaimError('already_claimed') on 409", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 409 }));
    try {
      await claimLinkCode("ABC");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaimError);
      expect((e as ClaimError).code).toBe("already_claimed");
    }
  });

  it("throws ClaimError('expired') on 410", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 410 }));
    try {
      await claimLinkCode("ABC");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ClaimError);
      expect((e as ClaimError).code).toBe("expired");
    }
  });

  it("passes network_id in body when provided", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ server_key_id: "sk", network_id: "n1" }), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    await claimLinkCode("ABC", { networkId: "n1" });
    const opts = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(opts.body as string)).toEqual({ network_id: "n1" });
  });

  it("sends empty body when networkId not provided", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ server_key_id: "sk", network_id: "n1" }), { status: 200 }),
    );
    global.fetch = fetchSpy as never;
    await claimLinkCode("ABC");
    const opts = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(opts.body as string)).toEqual({});
  });
});

describe("updateNetwork / updateServerKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("updateNetwork PATCHes name/slug and returns the network", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ network: { id: "n1", name: "Renamed", slug: "renamed", tier: "free" } }),
          { status: 200 },
        ),
    );
    const result = await updateNetwork("n1", { name: "Renamed", slug: "renamed" });
    expect(result.slug).toBe("renamed");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1$/),
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });

  it("updateNetwork throws the backend error code (slug_taken)", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "slug_taken" }), { status: 409 }),
    );
    await expect(updateNetwork("n1", { slug: "taken" })).rejects.toThrow("slug_taken");
  });

  it("updateServerKey PATCHes label/slug and returns the key summary", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "sk_1", label: "Creatif", slug: "creatif" }), {
          status: 200,
        }),
    );
    const result = await updateServerKey("n1", "sk_1", { label: "Creatif", slug: "creatif" });
    expect(result.slug).toBe("creatif");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/server-keys\/sk_1$/),
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });

  it("updateServerKey throws the backend error code", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "slug_taken" }), { status: 409 }),
    );
    await expect(updateServerKey("n1", "sk_1", { slug: "taken" })).rejects.toThrow("slug_taken");
  });
});
