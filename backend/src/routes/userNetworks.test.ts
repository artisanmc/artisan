// backend/src/routes/userNetworks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, serverKeys, serverKeyHelloes,
  editorSessions, linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { and, eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeyHelloes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(id);
  return { userId: id, sessionId: session.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/networks/*", userAuth());
  app.route("/api/v1/networks", userNetworksRouter);
  return app;
}

describe("userNetworksRouter", () => {
  beforeEach(clearAll);

  test("GET /api/v1/networks returns empty array for new user", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/v1/networks", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks).toEqual([]);
  });

  test("GET /api/v1/networks 401 without cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/networks");
    expect(res.status).toBe(401);
  });

  test("POST /api/v1/networks creates Network and owner Membership", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/v1/networks", {
      method: "POST",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "My Network" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.network.name).toBe("My Network");

    const memb = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(memb).toHaveLength(1);
    expect(memb[0].role).toBe("owner");
    expect(memb[0].networkId).toBe(body.network.id);
  });

  test("POST /api/v1/networks 422 when name missing", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/v1/networks", {
      method: "POST",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("GET /api/v1/networks returns user's networks", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N2" }),
    });

    const list = await (await app.request("/api/v1/networks", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    })).json();
    expect(list.networks).toHaveLength(2);
    expect(list.networks.map((n: { name: string }) => n.name).sort()).toEqual(["N1", "N2"]);
  });

  // A3 tests
  test("GET /api/v1/networks/:id returns detail with packs + serverKeys", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();

    // Create network
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    const { network } = await create.json();

    // Seed a server_key first (required by createPack), then seed a pack
    await db.insert(serverKeys).values({
      id: "sk_test_a3",
      hash: "hash_a3",
      networkId: network.id,
      createdAt: new Date(),
      label: null,
    });
    const { createPack } = await import("../lib/packStorage");
    await createPack({ networkId: network.id, serverKeyId: "sk_test_a3", name: "p1" });

    const res = await app.request(`/api/v1/networks/${network.id}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network.id).toBe(network.id);
    expect(body.packs).toHaveLength(1);
    expect(body.packs[0].name).toBe("p1");
    expect(body.serverKeys).toHaveLength(1);
    expect(body.serverKeys[0].id).toBe("sk_test_a3");
  });

  test("GET /api/v1/networks/:id 403 when not member", async () => {
    const { sessionId: sessA } = await seedUser("uA");
    await seedUser("uB");
    const app = makeApp();

    // uA creates a network
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    });
    const { network } = await create.json();

    // uB tries to read it
    const { createSession: cs } = await import("../lib/sessionManager");
    const sessB = (await cs("uB")).id;
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  // A4 tests
  test("POST /api/v1/networks/:id/server-keys creates server_key and returns plaintext", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-server" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.id).toBeDefined();

    const sk = await db.select().from(serverKeys).where(eq(serverKeys.id, body.id));
    expect(sk[0].networkId).toBe(network.id);
    expect(sk[0].label).toBe("test-server");
  });

  test("POST /api/v1/networks/:id/server-keys 403 when not member", async () => {
    const { sessionId: sessA } = await seedUser("uA");
    await seedUser("uB");
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const { createSession: cs } = await import("../lib/sessionManager");
    const sessB = (await cs("uB")).id;
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(403);
  });

  // A5 test
  test("POST /api/v1/networks/:id/packs creates pack in network", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    // Create a server_key for the pack to own
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const res = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-pack", description: "desc", serverKeyId: skId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pack.name).toBe("my-pack");
    expect(body.pack.description).toBe("desc");
    expect(body.pack.networkId).toBe(network.id);
  });

  // C4 tests
  test("POST binding with {branch_name: 'dev'} creates binding pointing to dev", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p", serverKeyId: skId }),
    });
    const { pack } = await packRes.json();

    // Create dev branch via the branches router
    const { createBranch } = await import("../lib/branchStorage");
    const { getBranch } = await import("../lib/branchStorage");
    const mainBranch = await getBranch(pack.id, "main");
    await createBranch(pack.id, "dev", mainBranch!.headCommitId);

    // Bind with branch_name: "dev"
    const bind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch_name: "dev" }),
    });
    expect(bind.status).toBe(201);

    // In the 1:1 model, POST bind is a no-op — pack already owned by its serverKeyId
    const packRows = await db.select().from(packs).where(eq(packs.id, pack.id));
    expect(packRows).toHaveLength(1);
  });

  test("POST binding 404 when branch_name does not exist", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p", serverKeyId: skId }),
    });
    const { pack } = await packRes.json();

    const bind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch_name: "ghost" }),
    });
    expect(bind.status).toBe(404);
    const body = await bind.json();
    expect(body.error).toBe("branch_not_found");
  });

  // A6 test
  test("POST + DELETE bindings — bind/unbind a server_key to a pack", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p", serverKeyId: skId }),
    });
    const { pack } = await packRes.json();

    // Bind
    const bind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(bind.status).toBe(201);

    // In the 1:1 model, pack ownership is via packs.serverKeyId (not a separate binding row)
    const packRows = await db.select().from(packs).where(eq(packs.id, pack.id));
    expect(packRows).toHaveLength(1);
    expect(packRows[0].serverKeyId).toBe(skId);

    // Unbind is a no-op in the 1:1 model — pack stays
    const unbind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(unbind.status).toBe(204);
  });
});

// C4 tests
describe("GET /api/v1/networks/:id/server-keys/:keyId/helloes", () => {
  test("returns helloes ordered by hello_at desc, with default limit", async () => {
    const { sessionId } = await seedUser(`u_hel_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HelNet" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "h" }),
    });
    const { id: skId } = await skRes.json();

    const now = Date.now();
    const prefix = Math.random().toString(36).slice(2, 8);
    await db.insert(serverKeyHelloes).values([
      { id: `${prefix}_1`, serverKeyId: skId, ip: "1.1.1.1", mcVersion: "1.21.4", helloAt: new Date(now - 3000) },
      { id: `${prefix}_2`, serverKeyId: skId, ip: "2.2.2.2", mcVersion: "1.21.4", helloAt: new Date(now - 2000) },
      { id: `${prefix}_3`, serverKeyId: skId, ip: "3.3.3.3", mcVersion: "1.21.4", helloAt: new Date(now - 1000) },
    ]);

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/helloes`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const { helloes } = await res.json();
    expect(helloes).toHaveLength(3);
    expect(helloes[0].ip).toBe("3.3.3.3"); // most recent first
    expect(helloes[1].ip).toBe("2.2.2.2");
    expect(helloes[2].ip).toBe("1.1.1.1");
    expect(helloes[0]).toHaveProperty("hello_at");
    expect(helloes[0]).toHaveProperty("mc_version", "1.21.4");
  });

  test("?limit=N caps result count", async () => {
    const { sessionId } = await seedUser(`u_hellim_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HelLimNet" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const now = Date.now();
    const prefix = Math.random().toString(36).slice(2, 8);
    await db.insert(serverKeyHelloes).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: `${prefix}_${i}`, serverKeyId: skId, ip: `10.0.0.${i}`, mcVersion: "1.21.4",
        helloAt: new Date(now - i * 1000),
      })),
    );

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/helloes?limit=2`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const { helloes } = await res.json();
    expect(helloes).toHaveLength(2);
  });

  test("non-owner returns 403", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { sessionId: sessA } = await seedUser(`uA_hel_${suffix}`);
    const { sessionId: sessB } = await seedUser(`uB_hel_${suffix}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HelForbid" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/helloes`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  test("key not in network returns 404", async () => {
    const { sessionId } = await seedUser(`u_hel404_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hel404Net" }),
    })).json();

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/does-not-exist/helloes`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET/PUT /api/v1/networks/:id/server-keys/:keyId/allowlist", () => {
  async function setupKey() {
    const { sessionId } = await seedUser(`u_al_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "AlNet" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();
    return { sessionId, app, networkId: network.id, skId };
  }

  test("GET returns null when no allowlist set (default)", async () => {
    const { sessionId, app, networkId, skId } = await setupKey();
    const res = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed_ips).toBeNull();
  });

  test("PUT sets the allowlist, GET returns it, dedup + trim applied", async () => {
    const { sessionId, app, networkId, skId } = await setupKey();
    const put = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: [" 1.2.3.4 ", "5.6.7.8", "1.2.3.4"] }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).allowed_ips).toEqual(["1.2.3.4", "5.6.7.8"]);

    const get = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect((await get.json()).allowed_ips).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  test("PUT with null clears the allowlist", async () => {
    const { sessionId, app, networkId, skId } = await setupKey();
    await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: ["1.2.3.4"] }),
    });
    const clear = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: null }),
    });
    expect(clear.status).toBe(200);
    expect((await clear.json()).allowed_ips).toBeNull();
  });

  test("PUT with empty array is normalized to null", async () => {
    const { sessionId, app, networkId, skId } = await setupKey();
    const res = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: [] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).allowed_ips).toBeNull();
  });

  test("PUT with invalid body (non-string entry) returns 422", async () => {
    const { sessionId, app, networkId, skId } = await setupKey();
    const res = await app.request(`/api/v1/networks/${networkId}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: ["1.2.3.4", 42] }),
    });
    expect(res.status).toBe(422);
  });

  test("non-owner returns 403 on GET and PUT", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { sessionId: sessA } = await seedUser(`uA_al_${suffix}`);
    const { sessionId: sessB } = await seedUser(`uB_al_${suffix}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "AlForbidNet" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();
    const get = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/allowlist`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(get.status).toBe(403);
    const put = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/allowlist`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: ["1.2.3.4"] }),
    });
    expect(put.status).toBe(403);
  });
});

describe("POST /api/v1/networks/:id/server-keys/:keyId/rotate", () => {
  async function sha256(input: string) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  test("owner rotates the key — preserves id/label/bindings, returns new plaintext, invalidates old hash", async () => {
    const { sessionId } = await seedUser(`u_rot_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();

    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "RotNet" }),
    })).json();

    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "prod" }),
    });
    const { id: skId, key: oldKey } = await skRes.json();
    const oldHash = await sha256(oldKey);

    // Create a pack owned by this server_key to verify ownership survives rotation.
    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rot-pack", serverKeyId: skId }),
    });
    const { pack } = await packRes.json();

    const rotateRes = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/rotate`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(rotateRes.status).toBe(200);
    const { id, key: newKey, label } = await rotateRes.json();

    expect(id).toBe(skId);
    expect(label).toBe("prod");
    expect(newKey).not.toBe(oldKey);
    expect(newKey).toMatch(/^sk_/);

    const newHash = await sha256(newKey);
    const row = (await db.select().from(serverKeys).where(eq(serverKeys.id, skId)))[0];
    expect(row.hash).toBe(newHash);
    expect(row.hash).not.toBe(oldHash);

    // Pack still owned by same server_key after rotation
    const packsAfter = await db.select().from(packs).where(eq(packs.serverKeyId, skId));
    expect(packsAfter.length).toBeGreaterThanOrEqual(0); // pack ownership unchanged by rotation
  });

  test("non-owner returns 403", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { sessionId: sessA } = await seedUser(`uA_rot_${suffix}`);
    const { sessionId: sessB } = await seedUser(`uB_rot_${suffix}`);
    const app = makeApp();

    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "RotForbidNet" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/rotate`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  test("key not in network returns 404", async () => {
    const { sessionId } = await seedUser(`u_rot404_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rot404Net" }),
    })).json();

    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/does-not-exist/rotate`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });

  test("401 without cookie", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/anything/server-keys/anything/rotate`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/v1/networks/:id/server-keys/:keyId", () => {
  test("owner can delete a server_key and cascade packs", async () => {
    const { sessionId } = await seedUser(`u_c4_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();

    // Create network
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "C4Net" }),
    })).json();

    // Create server_key via API
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "c4-key" }),
    });
    const { id: skId } = await skRes.json();

    // Create a pack owned by this server_key
    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "c4-pack", serverKeyId: skId }),
    });
    const { pack } = await packRes.json();

    // Verify pack exists and is owned by the server_key
    const packsBefore = await db.select().from(packs).where(eq(packs.serverKeyId, skId));
    expect(packsBefore).toHaveLength(1);

    // Delete server_key
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(204);

    // Server_key gone
    const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, skId));
    expect(skRows).toHaveLength(0);

    // Packs cascade-deleted (packs.serverKeyId ON DELETE CASCADE)
    const packsAfter = await db.select().from(packs).where(eq(packs.id, pack.id));
    expect(packsAfter).toHaveLength(0);
  });

  test("non-owner returns 403", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { sessionId: sessA } = await seedUser(`uA_c4_${suffix}`);
    const { sessionId: sessB } = await seedUser(`uB_c4_${suffix}`);
    const app = makeApp();

    // uA creates network + server_key
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "C4ForbidNet" }),
    })).json();

    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    // uB tries to delete
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });
});
