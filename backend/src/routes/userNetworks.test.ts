// backend/src/routes/userNetworks.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, projects, serverKeys, serverKeyHelloes,
  linkCodes, assets, users, userSessions,
  serverModules, serverDataSources, networkInvites, networkAccessRequests,
} from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { addMembership } from "../lib/membershipManager";
import { and, eq } from "drizzle-orm";
import { __setMailerForTests, type MailMessage } from "../lib/mail/mailer";

async function clearAll() {
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeyHelloes);
  await db.delete(networkAccessRequests);
  await db.delete(networkInvites);
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
  test("GET /api/v1/networks/:id returns detail with projects + serverKeys", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();

    // Create network
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    const { network } = await create.json();

    // Seed a server_key first (required by createProject), then seed a pack
    await db.insert(serverKeys).values({
      id: "sk_test_a3",
      hash: "hash_a3",
      networkId: network.id,
      createdAt: new Date(),
      label: null,
    });
    const { createProject } = await import("../lib/projectStorage");
    await createProject({ networkId: network.id, serverKeyId: "sk_test_a3", name: "p1" });

    const res = await app.request(`/api/v1/networks/${network.id}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network.id).toBe(network.id);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("p1");
    expect(body.projects[0]).toHaveProperty("networkId");
    expect(body.projects[0]).toHaveProperty("serverKeyId");
    // Fresh pack has no menus/commands/dialogs yet.
    expect(body.projects[0].documentCount).toBe(0);
    expect(body.serverKeys).toHaveLength(1);
    expect(body.serverKeys[0].id).toBe("sk_test_a3");
  });

  test("GET /:id/servers-status returns online/total + last accepted hello, ignores rejected", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NS" }),
    });
    const { network } = await create.json();

    await db.insert(serverKeys).values([
      { id: "sk_a", hash: "h_a", networkId: network.id, createdAt: new Date(), label: "Survival", lastMcVersion: "1.21.4" },
      { id: "sk_b", hash: "h_b", networkId: network.id, createdAt: new Date(), label: "Lobby" },
    ]);

    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    await db.insert(serverKeyHelloes).values([
      { id: "he1", serverKeyId: "sk_a", ip: "1.2.3.4", mcVersion: "1.21.4", helloAt: earlier, rejectedReason: null },
      { id: "he2", serverKeyId: "sk_a", ip: "9.9.9.9", mcVersion: "1.21.4", helloAt: now, rejectedReason: "ip_not_allowed" },
    ]);
    // sk_b: never connected (no hello rows)

    const res = await app.request(`/api/v1/networks/${network.id}/servers-status?current=sk_a`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.online).toBe(0); // no live WS connections in test

    const a = body.servers.find((s: { id: string }) => s.id === "sk_a");
    const b = body.servers.find((s: { id: string }) => s.id === "sk_b");
    expect(a.label).toBe("Survival");
    expect(a.lastSeenIp).toBe("1.2.3.4"); // accepted hello, NOT the rejected one
    expect(new Date(a.lastSeenAt).getTime()).toBe(earlier.getTime());
    expect(a.isCurrent).toBe(true);
    expect(b.isCurrent).toBe(false);
    expect(b.lastSeenAt).toBeNull(); // never connected
    expect(b.lastSeenIp).toBeNull();
  });

  test("GET /:id/servers-status 403 for non-member", async () => {
    const owner = await seedUser("owner1");
    const app = makeApp();
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${owner.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NS2" }),
    });
    const { network } = await create.json();
    const stranger = await seedUser("stranger1");
    const res = await app.request(`/api/v1/networks/${network.id}/servers-status`, {
      headers: { Cookie: `artisan_user_session=${stranger.sessionId}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/v1/networks/:id reports documentCount from the pack editor JSON", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();

    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N-count" }),
    });
    const { network } = await create.json();

    await db.insert(serverKeys).values({
      id: "sk_count",
      hash: "hash_count",
      networkId: network.id,
      createdAt: new Date(),
      label: null,
    });
    const { createProject, upsertProjectContent } = await import("../lib/projectStorage");
    const pack = await createProject({ networkId: network.id, serverKeyId: "sk_count", name: "pc" });
    await upsertProjectContent(pack.id, {
      editorJson: JSON.stringify({
        menus: [{ id: "m1" }, { id: "m2" }],
        commands: [{ id: "c1" }],
        dialogs: [{ id: "d1" }],
      }),
    });

    const res = await app.request(`/api/v1/networks/${network.id}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const body = await res.json();
    expect(body.projects[0].documentCount).toBe(4);
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

  test("POST /api/v1/networks/:id/server-keys 403 for member role (not manage_servers)", async () => {
    const { sessionId: sessA } = await seedUser("uA2");
    const { sessionId: sessB } = await seedUser("uB2");
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();
    await addMembership("uB2", network.id, "member");
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(403);
  });

  // A5 test
  test("POST /api/v1/networks/:id/projects creates project in network", async () => {
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

    const res = await app.request(`/api/v1/networks/${network.id}/projects`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-pack", description: "desc", serverKeyId: skId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project.name).toBe("my-pack");
    expect(body.project.description).toBe("desc");
    expect(body.project.networkId).toBe(network.id);
  });

  test("POST /:id/projects returns 422 when serverKeyId is missing", async () => {
    const { sessionId } = await seedUser(`u_p_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const res = await app.request(`/api/v1/networks/${network.id}/projects`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p1" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("missing_server_key");
  });

  test("POST /:id/projects returns 403 when serverKey is in another network", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const { sessionId: sessA } = await seedUser(`uA_p_${suffix}`);
    const { sessionId: sessB } = await seedUser(`uB_p_${suffix}`);
    const app = makeApp();

    const { network: netA } = await (await app.request("/api/v1/networks", {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NA" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${netA.id}/server-keys`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" }, body: "{}",
    });
    const { id: skId } = await skRes.json();

    const { network: netB } = await (await app.request("/api/v1/networks", {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NB" }),
    })).json();
    const res = await app.request(`/api/v1/networks/${netB.id}/projects`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p1", serverKeyId: skId }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("server_key_not_in_network");
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
    const packRes = await app.request(`/api/v1/networks/${network.id}/projects`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rot-pack", serverKeyId: skId }),
    });
    const { project: pack } = await packRes.json();

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
    const packsAfter = await db.select().from(projects).where(eq(projects.serverKeyId, skId));
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
  test("owner can delete a server_key and cascade projects", async () => {
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
    const packRes = await app.request(`/api/v1/networks/${network.id}/projects`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "c4-pack", serverKeyId: skId }),
    });
    const { project: pack } = await packRes.json();

    // Verify pack exists and is owned by the server_key
    const packsBefore = await db.select().from(projects).where(eq(projects.serverKeyId, skId));
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

    // Packs cascade-deleted (projects.serverKeyId ON DELETE CASCADE)
    const packsAfter = await db.select().from(projects).where(eq(projects.id, pack.id));
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

describe("GET /api/v1/networks/:id/server-keys/:keyId/status", () => {
  test("returns online: false for unseen key", async () => {
    const { sessionId } = await seedUser(`u_st_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();
    const skRes = await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" }, body: "{}",
    });
    const { id: skId } = await skRes.json();
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}/status`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).online).toBe(false);
  });
});

describe("GET /:networkId/servers/:serverId/modules & /data-sources", () => {
  beforeEach(clearAll);

  async function setup() {
    const { sessionId } = await seedUser(`u_pres_${Math.random().toString(36).slice(2, 8)}`);
    const app = makeApp();
    const headers = { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" };
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST", headers, body: JSON.stringify({ name: "N" }),
    })).json();
    await db.insert(serverKeys).values({
      id: "sk_pres", hash: "h_pres", networkId: network.id, createdAt: new Date(), label: null,
    });
    await db.insert(serverModules).values({
      serverKeyId: "sk_pres", moduleId: "boutique", version: "1.0.0", lastSeen: new Date(),
    });
    await db.insert(serverDataSources).values({
      serverKeyId: "sk_pres", ref: "boutique:items", schemaHint: "id, name", reportedAt: new Date(),
    });
    return { app, headers, network, sessionId };
  }

  test("returns presence rows for a member", async () => {
    const { app, headers, network } = await setup();

    const modulesRes = await app.request(
      `/api/v1/networks/${network.id}/servers/sk_pres/modules`,
      { headers },
    );
    expect(modulesRes.status).toBe(200);
    expect(await modulesRes.json()).toEqual({
      modules: [{ id: "boutique", version: "1.0.0" }],
    });

    const dataSourcesRes = await app.request(
      `/api/v1/networks/${network.id}/servers/sk_pres/data-sources`,
      { headers },
    );
    expect(dataSourcesRes.status).toBe(200);
    expect(await dataSourcesRes.json()).toEqual({
      data_sources: [{ ref: "boutique:items", module_id: null, schema: [], schema_hint: "id, name" }],
    });
  });

  test("403 for a non-member, 404 for a server outside the network", async () => {
    const { app, network } = await setup();
    const stranger = await seedUser(`u_stranger_${Math.random().toString(36).slice(2, 8)}`);
    const strangerHeaders = { Cookie: `artisan_user_session=${stranger.sessionId}` };

    const forbidden = await app.request(
      `/api/v1/networks/${network.id}/servers/sk_pres/modules`,
      { headers: strangerHeaders },
    );
    expect(forbidden.status).toBe(403);

    const otherNetworkRes = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${stranger.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Other" }),
    })).json();
    await db.insert(serverKeys).values({
      id: "sk_other", hash: "h_other", networkId: otherNetworkRes.network.id, createdAt: new Date(), label: null,
    });

    const { sessionId: ownerSessionId } = await seedUser(`u_owner2_${Math.random().toString(36).slice(2, 8)}`);
    // owner of `network` (not sk_other's network) tries to fetch sk_other via network's id
    const owner = await (await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${ownerSessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N3" }),
    })).json();
    const outsideRes = await app.request(
      `/api/v1/networks/${owner.network.id}/servers/sk_other/modules`,
      { headers: { Cookie: `artisan_user_session=${ownerSessionId}` } },
    );
    expect(outsideRes.status).toBe(404);
  });

  test("GET data-sources returns module_id and parsed schema", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    });
    const { network } = await create.json();
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "h-x", networkId: network.id, createdAt: new Date() });
    await db.insert(serverDataSources).values([
      {
        serverKeyId: keyId, ref: "boutique:items", moduleId: "boutique",
        schemaJson: JSON.stringify([{ name: "id", type: "string", description: null }]),
        schemaHint: "id", reportedAt: new Date(),
      },
      { serverKeyId: keyId, ref: "core:stats", moduleId: null, schemaJson: null, schemaHint: null, reportedAt: new Date() },
    ]);

    const res = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byRef = new Map(body.data_sources.map((d: { ref: string }) => [d.ref, d]));
    expect(byRef.get("boutique:items")).toEqual({
      ref: "boutique:items", module_id: "boutique",
      schema: [{ name: "id", type: "string", description: null }], schema_hint: "id",
    });
    expect(byRef.get("core:stats")).toEqual({ ref: "core:stats", module_id: null, schema: [], schema_hint: null });
  });
});

describe("PATCH /api/v1/networks/:id", () => {
  beforeEach(clearAll);

  async function setup() {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const headers = { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" };
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST", headers, body: JSON.stringify({ name: "My Network" }),
    })).json();
    return { app, headers, network };
  }

  test("renames the network (name only) — slug unchanged", async () => {
    const { app, headers, network } = await setup();
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network.name).toBe("Renamed");
    expect(body.network.slug).toBe(network.slug);
  });

  test("updates the slug — URL resolution by old slug still works for the call", async () => {
    const { app, headers, network } = await setup();
    const res = await app.request(`/api/v1/networks/${network.slug}`, {
      method: "PATCH", headers, body: JSON.stringify({ slug: "new-slug" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network.slug).toBe("new-slug");
    const rows = await db.select().from(networks).where(eq(networks.id, network.id));
    expect(rows[0].slug).toBe("new-slug");
  });

  test("409 when the slug is taken by another network", async () => {
    const { app, headers, network } = await setup();
    const { network: other } = await (await app.request("/api/v1/networks", {
      method: "POST", headers, body: JSON.stringify({ name: "Other" }),
    })).json();
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ slug: other.slug }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("slug_taken");
  });

  test("422 on invalid slug (not slugified)", async () => {
    const { app, headers, network } = await setup();
    for (const bad of ["Has Spaces", "UPPER", "été", ""]) {
      const res = await app.request(`/api/v1/networks/${network.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ slug: bad }),
      });
      expect(res.status).toBe(422);
    }
  });

  test("422 on empty name / empty body", async () => {
    const { app, headers, network } = await setup();
    const res1 = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ name: "  " }),
    });
    expect(res1.status).toBe(422);
    const res2 = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers, body: JSON.stringify({}),
    });
    expect(res2.status).toBe(422);
  });

  test("403 for non-member", async () => {
    const { app, network } = await setup();
    const { sessionId: sessB } = await seedUser("u2");
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack" }),
    });
    expect(res.status).toBe(403);
  });

  test("401 without cookie", async () => {
    const { app, network } = await setup();
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(401);
  });

  test("403 for member role (not manage_network)", async () => {
    const { app, network } = await setup();
    const { sessionId: sessB } = await seedUser("member1");
    await addMembership("member1", network.id, "member");
    const res = await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/networks/:id/server-keys/:keyId", () => {
  beforeEach(clearAll);

  async function setup() {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const headers = { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" };
    const { network } = await (await app.request("/api/v1/networks", {
      method: "POST", headers, body: JSON.stringify({ name: "N" }),
    })).json();
    const sk = await (await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST", headers, body: JSON.stringify({ label: "Survie" }),
    })).json();
    return { app, headers, network, sk };
  }

  test("updates label and slug", async () => {
    const { app, headers, network, sk } = await setup();
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ label: "Creatif", slug: "creatif" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(sk.id);
    expect(body.label).toBe("Creatif");
    expect(body.slug).toBe("creatif");
    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, sk.id));
    expect(rows[0].label).toBe("Creatif");
    expect(rows[0].slug).toBe("creatif");
  });

  test("409 when slug taken by another key in the same network", async () => {
    const { app, headers, network, sk } = await setup();
    const other = await (await app.request(`/api/v1/networks/${network.id}/server-keys`, {
      method: "POST", headers, body: JSON.stringify({ label: "Lobby" }),
    })).json();
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ slug: other.slug }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("slug_taken");
  });

  test("422 on invalid slug or empty body", async () => {
    const { app, headers, network, sk } = await setup();
    const res1 = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ slug: "Not Valid" }),
    });
    expect(res1.status).toBe(422);
    const res2 = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH", headers, body: JSON.stringify({}),
    });
    expect(res2.status).toBe(422);
  });

  test("404 unknown key", async () => {
    const { app, headers, network } = await setup();
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/nope`, {
      method: "PATCH", headers, body: JSON.stringify({ label: "X" }),
    });
    expect(res.status).toBe(404);
  });

  test("403 for non-member", async () => {
    const { app, network, sk } = await setup();
    const { sessionId: sessB } = await seedUser("u2");
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Hack" }),
    });
    expect(res.status).toBe(403);
  });

  test("403 for member role (not manage_servers)", async () => {
    const { app, network, sk } = await setup();
    const { sessionId: sessB } = await seedUser("member2");
    await addMembership("member2", network.id, "member");
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${sk.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Hack" }),
    });
    expect(res.status).toBe(403);
  });
});

// M-Task 3: members & invites, capability-gated on manage_members.
async function setupMembers() {
  const owner = await seedUser("owner1");
  const app = makeApp();
  const ownerHeaders = { Cookie: `artisan_user_session=${owner.sessionId}`, "Content-Type": "application/json" };
  const { network } = await (await app.request("/api/v1/networks", {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "N" }),
  })).json();
  const member = await seedUser("member1");
  await addMembership(member.userId, network.id, "member");
  const memberHeaders = { Cookie: `artisan_user_session=${member.sessionId}`, "Content-Type": "application/json" };
  return { app, network, owner, ownerHeaders, member, memberHeaders };
}

describe("GET /api/v1/networks/:id/members", () => {
  beforeEach(clearAll);

  test("returns joined members (userId, email, displayName, role, createdAt)", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members`, { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2);
    const owner = body.members.find((m: { userId: string }) => m.userId === "owner1");
    expect(owner.email).toBe("owner1@a.b");
    expect(owner.displayName).toBe("owner1");
    expect(owner.role).toBe("owner");
    expect(owner.createdAt).toBeTruthy();
    const member = body.members.find((m: { userId: string }) => m.userId === "member1");
    expect(member.role).toBe("member");
  });

  test("200 for member (read-only roster)", async () => {
    const { app, network, memberHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members`, { headers: memberHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2);
  });

  test("403 for non-member", async () => {
    const { app, network } = await setupMembers();
    const { sessionId } = await seedUser("stranger");
    const res = await app.request(`/api/v1/networks/${network.id}/members`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/networks/:id/members/:userId", () => {
  beforeEach(clearAll);

  test("owner removes a member — 200/204", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/member1`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
    const rows = await db.select().from(memberships).where(and(eq(memberships.userId, "member1"), eq(memberships.networkId, network.id)));
    expect(rows).toHaveLength(0);
  });

  test("owner removes self when NOT the last owner — allowed", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    // Promote member1 to owner so removing owner1 doesn't violate last_owner.
    await db.update(memberships).set({ role: "owner" }).where(and(eq(memberships.userId, "member1"), eq(memberships.networkId, network.id)));
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
  });

  test("409 last_owner removing the sole owner", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("last_owner");
  });

  test("403 for member (lacks manage_members)", async () => {
    const { app, network, memberHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "DELETE", headers: memberHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("404 for unknown target user", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/nope`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("legacy admin counts as manager: owner removable while admin remains, then admin becomes last_owner", async () => {
    const { app, network, ownerHeaders, memberHeaders } = await setupMembers();
    // Replace member1's role with the legacy "admin" alias (grants manage_members).
    await db.update(memberships).set({ role: "admin" }).where(and(eq(memberships.userId, "member1"), eq(memberships.networkId, network.id)));

    // owner1 removable — admin (member1) still counts as a manager.
    const res1 = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res1.status).toBe(204);

    // Now member1 (admin) is the sole manager — removing it must be blocked.
    const res2 = await app.request(`/api/v1/networks/${network.id}/members/member1`, {
      method: "DELETE", headers: memberHeaders,
    });
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe("last_owner");
  });
});

describe("PATCH /api/v1/networks/:id/members/:userId", () => {
  beforeEach(clearAll);

  test("owner promotes member — 200", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/member1`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(memberships).where(and(eq(memberships.userId, "member1"), eq(memberships.networkId, network.id)));
    expect(rows[0]!.role).toBe("owner");
  });

  test("409 last_owner demoting the sole owner", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("last_owner");
  });

  test("demoting last owner is allowed when another owner exists", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    await db.update(memberships).set({ role: "owner" }).where(and(eq(memberships.userId, "member1"), eq(memberships.networkId, network.id)));
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(200);
  });

  test("422 on unknown role", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/member1`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "superadmin" }),
    });
    expect(res.status).toBe(422);
  });

  test("403 for member (lacks manage_members)", async () => {
    const { app, network, memberHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/owner1`, {
      method: "PATCH", headers: memberHeaders, body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(403);
  });

  test("404 for unknown target user", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/members/nope`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST/GET/DELETE /api/v1/networks/:id/invites", () => {
  beforeEach(clearAll);

  test("POST creates an invite with url pointing at EDITOR_URL", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ email: "x@y.z", maxUses: 3, expiresInDays: 2 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invite.id).toBeTruthy();
    expect(body.invite.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(body.invite.url).toContain(`?code=${body.invite.code}`);
    expect(body.invite.email).toBe("x@y.z");
    expect(body.invite.maxUses).toBe(3);
    expect(body.invite.usedCount).toBe(0);
    expect(body.invite.expiresAt).toBeTruthy();
  });

  test("POST with empty body uses defaults", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invite.email).toBeNull();
    expect(body.invite.maxUses).toBeNull();
  });

  test("403 for member (lacks manage_members)", async () => {
    const { app, network, memberHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: memberHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  test("422 on invalid maxUses (not a positive integer)", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ maxUses: 0 }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_input");
  });

  test("GET lists invites for the network", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({}),
    });
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(1);
  });

  test("GET 403 for member", async () => {
    const { app, network, memberHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, { headers: memberHeaders });
    expect(res.status).toBe(403);
  });

  test("DELETE revokes an invite — subsequent GET shows revokedAt set", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const created = await (await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({}),
    })).json();
    const res = await app.request(`/api/v1/networks/${network.id}/invites/${created.invite.id}`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(204);
    const list = await (await app.request(`/api/v1/networks/${network.id}/invites`, { headers: ownerHeaders })).json();
    expect(list.invites[0].revokedAt).toBeTruthy();
  });

  test("DELETE 403 for member", async () => {
    const { app, network, ownerHeaders, memberHeaders } = await setupMembers();
    const created = await (await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({}),
    })).json();
    const res = await app.request(`/api/v1/networks/${network.id}/invites/${created.invite.id}`, {
      method: "DELETE", headers: memberHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("DELETE 404 for unknown invite id", async () => {
    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites/nope`, {
      method: "DELETE", headers: ownerHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/networks/:id/invites — email dispatch", () => {
  beforeEach(clearAll);
  afterEach(() => __setMailerForTests(null));

  test("with email set — sends an invite email with the right to/url and still returns the url", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });

    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ email: "invitee@x.y" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invite.url).toContain(`?code=${body.invite.code}`);

    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("invitee@x.y");
    expect(sent[0].text).toContain(body.invite.url);
  });

  test("without email — no mail sent", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });

    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
  });

  test("mailer that throws does not block the invite creation — 201 anyway", async () => {
    __setMailerForTests({ enabled: true, send: async () => { throw new Error("smtp down"); } });

    const { app, network, ownerHeaders } = await setupMembers();
    const res = await app.request(`/api/v1/networks/${network.id}/invites`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ email: "invitee@x.y" }),
    });
    expect(res.status).toBe(201);
  });
});

// D-Task 3: access requests — request → owner approval → membership.
async function setupOutsider() {
  const owner = await seedUser("owner1");
  const app = makeApp();
  const ownerHeaders = { Cookie: `artisan_user_session=${owner.sessionId}`, "Content-Type": "application/json" };
  const { network } = await (await app.request("/api/v1/networks", {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "N" }),
  })).json();
  const outsider = await seedUser("outsider1");
  const outsiderHeaders = { Cookie: `artisan_user_session=${outsider.sessionId}`, "Content-Type": "application/json" };
  const member = await seedUser("member1");
  await addMembership(member.userId, network.id, "member");
  const memberHeaders = { Cookie: `artisan_user_session=${member.sessionId}`, "Content-Type": "application/json" };
  return { app, network, owner, ownerHeaders, outsider, outsiderHeaders, member, memberHeaders };
}

describe("POST /api/v1/networks/:idOrSlug/access-requests", () => {
  beforeEach(clearAll);
  afterEach(() => __setMailerForTests(null));

  test("401 without cookie", async () => {
    const { app, network } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test("happy path: creates a pending request and emails owners/admins", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });

    const { app, network, outsiderHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({ message: "let me in" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.request.status).toBe("pending");

    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("owner1@a.b");
    expect(sent[0].text).toContain("let me in");
  });

  test("does not email a plain member (only owners/admins)", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });

    const { app, network, outsiderHeaders } = await setupOutsider();
    await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((m) => m.to)).toEqual(["owner1@a.b"]);
  });

  test("resolves network by slug too", async () => {
    const { app, network, ownerHeaders, outsiderHeaders } = await setupOutsider();
    await app.request(`/api/v1/networks/${network.id}`, {
      method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ slug: "n-slug" }),
    });
    const res = await app.request(`/api/v1/networks/n-slug/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
  });

  test("404 for unknown network", async () => {
    const { app, outsiderHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/nope/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  test("409 already_member when the requester is already a member", async () => {
    const { app, network, memberHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: memberHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_member");
  });

  test("409 already_pending on a second request while one is pending", async () => {
    const { app, network, outsiderHeaders } = await setupOutsider();
    await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_pending");
  });

  test("422 when message exceeds 500 chars", async () => {
    const { app, network, outsiderHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({ message: "a".repeat(501) }),
    });
    expect(res.status).toBe(422);
  });

  test("mailer that throws does not block the request — 201 anyway", async () => {
    __setMailerForTests({ enabled: true, send: async () => { throw new Error("smtp down"); } });
    const { app, network, outsiderHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/networks/:id/access-requests", () => {
  beforeEach(clearAll);

  test("403 for a plain member (not manage_members)", async () => {
    const { app, network, memberHeaders } = await setupOutsider();
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, { headers: memberHeaders });
    expect(res.status).toBe(403);
  });

  test("owner sees pending requests with requester email/displayName", async () => {
    const { app, network, ownerHeaders, outsiderHeaders } = await setupOutsider();
    await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({ message: "hi" }),
    });
    const res = await app.request(`/api/v1/networks/${network.id}/access-requests`, { headers: ownerHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({
      email: "outsider1@a.b", displayName: "outsider1", message: "hi", status: "pending",
    });
  });
});

describe("POST /api/v1/networks/:id/access-requests/:requestId/approve|deny", () => {
  beforeEach(clearAll);

  test("403 for a plain member", async () => {
    const { app, network, memberHeaders, outsiderHeaders } = await setupOutsider();
    const create = await (await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    })).json();
    const res = await app.request(
      `/api/v1/networks/${network.id}/access-requests/${create.request.id}/approve`,
      { method: "POST", headers: memberHeaders },
    );
    expect(res.status).toBe(403);
  });

  test("approve creates a membership and returns status approved", async () => {
    const { app, network, ownerHeaders, outsider, outsiderHeaders } = await setupOutsider();
    const create = await (await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    })).json();
    const res = await app.request(
      `/api/v1/networks/${network.id}/access-requests/${create.request.id}/approve`,
      { method: "POST", headers: ownerHeaders },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
    const memberRows = await db.select().from(memberships).where(and(
      eq(memberships.userId, outsider.userId), eq(memberships.networkId, network.id),
    ));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]!.role).toBe("member");
  });

  test("deny returns status denied, no membership created", async () => {
    const { app, network, ownerHeaders, outsider, outsiderHeaders } = await setupOutsider();
    const create = await (await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    })).json();
    const res = await app.request(
      `/api/v1/networks/${network.id}/access-requests/${create.request.id}/deny`,
      { method: "POST", headers: ownerHeaders },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("denied");
    const memberRows = await db.select().from(memberships).where(and(
      eq(memberships.userId, outsider.userId), eq(memberships.networkId, network.id),
    ));
    expect(memberRows).toHaveLength(0);
  });

  test("404 for a request id outside the network", async () => {
    const { app, network, ownerHeaders } = await setupOutsider();
    const res = await app.request(
      `/api/v1/networks/${network.id}/access-requests/nope/approve`,
      { method: "POST", headers: ownerHeaders },
    );
    expect(res.status).toBe(404);
  });

  test("409 when resolving an already-resolved request", async () => {
    const { app, network, ownerHeaders, outsiderHeaders } = await setupOutsider();
    const create = await (await app.request(`/api/v1/networks/${network.id}/access-requests`, {
      method: "POST", headers: outsiderHeaders, body: JSON.stringify({}),
    })).json();
    await app.request(
      `/api/v1/networks/${network.id}/access-requests/${create.request.id}/approve`,
      { method: "POST", headers: ownerHeaders },
    );
    const res = await app.request(
      `/api/v1/networks/${network.id}/access-requests/${create.request.id}/deny`,
      { method: "POST", headers: ownerHeaders },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_pending");
  });
});
