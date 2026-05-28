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
import { and, eq } from "drizzle-orm";

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

    const res = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-pack", description: "desc" }),
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
      body: JSON.stringify({ name: "p" }),
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

    const bindings = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].branchName).toBe("dev");
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
      body: JSON.stringify({ name: "p" }),
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
      body: JSON.stringify({ name: "p" }),
    });
    const { pack } = await packRes.json();

    // Bind
    const bind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(bind.status).toBe(201);

    const bindings = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].serverKeyId).toBe(skId);

    // Unbind
    const unbind = await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(unbind.status).toBe(204);

    const after = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
    expect(after).toHaveLength(0);
  });
});

// C4 tests
describe("DELETE /api/v1/networks/:id/server-keys/:keyId", () => {
  test("owner can delete a server_key and cascade pack_bindings", async () => {
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

    // Create a pack and bind it
    const packRes = await app.request(`/api/v1/networks/${network.id}/packs`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "c4-pack" }),
    });
    const { pack } = await packRes.json();

    await app.request(`/api/v1/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });

    // Verify binding exists
    const bindingsBefore = await db.select().from(packBindings).where(eq(packBindings.serverKeyId, skId));
    expect(bindingsBefore).toHaveLength(1);

    // Delete server_key
    const res = await app.request(`/api/v1/networks/${network.id}/server-keys/${skId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(204);

    // Server_key gone
    const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, skId));
    expect(skRows).toHaveLength(0);

    // Bindings gone (cascaded)
    const bindingsAfter = await db.select().from(packBindings).where(eq(packBindings.serverKeyId, skId));
    expect(bindingsAfter).toHaveLength(0);
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
