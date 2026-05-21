// backend/src/routes/userNetworks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(packBindings);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
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
  app.use("/api/networks/*", userAuth());
  app.route("/api/networks", userNetworksRouter);
  return app;
}

describe("userNetworksRouter", () => {
  beforeEach(clearAll);

  test("GET /api/networks returns empty array for new user", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks).toEqual([]);
  });

  test("GET /api/networks 401 without cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/networks");
    expect(res.status).toBe(401);
  });

  test("POST /api/networks creates Network and owner Membership", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `ifz_user_session=${sessionId}`,
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

  test("POST /api/networks 422 when name missing", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `ifz_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("GET /api/networks returns user's networks", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N2" }),
    });

    const list = await (await app.request("/api/networks", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    })).json();
    expect(list.networks).toHaveLength(2);
    expect(list.networks.map((n: { name: string }) => n.name).sort()).toEqual(["N1", "N2"]);
  });

  // A3 tests
  test("GET /api/networks/:id returns detail with packs + serverKeys", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();

    // Create network
    const create = await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    const { network } = await create.json();

    // Seed a pack and a server_key in this network directly via DB
    const { createPack } = await import("../lib/packStorage");
    await createPack({ networkId: network.id, name: "p1" });
    await db.insert(serverKeys).values({
      id: "sk_test_a3",
      hash: "hash_a3",
      networkId: network.id,
      createdAt: new Date(),
      label: null,
    });

    const res = await app.request(`/api/networks/${network.id}`, {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network.id).toBe(network.id);
    expect(body.packs).toHaveLength(1);
    expect(body.packs[0].name).toBe("p1");
    expect(body.serverKeys).toHaveLength(1);
    expect(body.serverKeys[0].id).toBe("sk_test_a3");
  });

  test("GET /api/networks/:id 403 when not member", async () => {
    const { sessionId: sessA } = await seedUser("uA");
    await seedUser("uB");
    const app = makeApp();

    // uA creates a network
    const create = await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    });
    const { network } = await create.json();

    // uB tries to read it
    const { createSession: cs } = await import("../lib/sessionManager");
    const sessB = (await cs("uB")).id;
    const res = await app.request(`/api/networks/${network.id}`, {
      headers: { Cookie: `ifz_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  // A4 tests
  test("POST /api/networks/:id/server-keys creates server_key and returns plaintext", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const res = await app.request(`/api/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
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

  test("POST /api/networks/:id/server-keys 403 when not member", async () => {
    const { sessionId: sessA } = await seedUser("uA");
    await seedUser("uB");
    const app = makeApp();
    const { network } = await (await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const { createSession: cs } = await import("../lib/sessionManager");
    const sessB = (await cs("uB")).id;
    const res = await app.request(`/api/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(403);
  });

  // A5 test
  test("POST /api/networks/:id/packs creates pack in network", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const res = await app.request(`/api/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-pack", description: "desc" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pack.name).toBe("my-pack");
    expect(body.pack.description).toBe("desc");
    expect(body.pack.networkId).toBe(network.id);
  });

  // A6 test
  test("POST + DELETE bindings — bind/unbind a server_key to a pack", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const { network } = await (await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    })).json();

    const skRes = await app.request(`/api/networks/${network.id}/server-keys`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { id: skId } = await skRes.json();

    const packRes = await app.request(`/api/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p" }),
    });
    const { pack } = await packRes.json();

    // Bind
    const bind = await app.request(`/api/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(bind.status).toBe(201);

    const bindings = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].serverKeyId).toBe(skId);

    // Unbind
    const unbind = await app.request(`/api/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(unbind.status).toBe(204);

    const after = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
    expect(after).toHaveLength(0);
  });
});
