import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptNetworkTransfer,
  createNetwork,
  createProject,
  createServerKey,
  deleteServerKey,
  getNetwork,
  getNetworkTransfer,
  initNetworkTransfer,
  listNetworks,
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
            projects: [{ id: "p1", name: "pack1", hash: "h1" }],
            serverKeys: [{ id: "sk_1", label: null }],
          }),
          { status: 200 },
        ),
    );
    const result = await getNetwork("n1");
    expect(result.network.id).toBe("n1");
    expect(result.projects).toHaveLength(1);
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

  it("createProject POST /api/v1/networks/:id/projects returns project", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: { id: "p_new", name: "new-project", hash: "h_new" },
          }),
          { status: 201 },
        ),
    );
    const result = await createProject("n1", "sk1", "new-project");
    expect(result.name).toBe("new-project");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/networks\/n1\/projects$/),
      expect.objectContaining({ method: "POST" }),
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
      projectCount: 2,
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
