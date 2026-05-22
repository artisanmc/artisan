// backend/src/routes/userNetworks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index";
import { networks, memberships, serverKeys, packs, packBindings } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { requireMember } from "../lib/membershipGuard";
import { listPacksForNetwork, createPack } from "../lib/packStorage";
import { generateServerKey } from "../lib/auth";
import { createBinding, deleteBinding } from "../lib/packBindingManager";
import { getBranch } from "../lib/branchStorage";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userNetworksRouter = new Hono<{ Variables: Vars }>();

// Helper: get authenticated userId or return null
function getUserId(c: Context<{ Variables: Vars }>): string | null {
  const user = c.get("user");
  return user?.id ?? null;
}

// GET /api/networks — list user's networks
userNetworksRouter.get("/", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const memb = await db.select({ networkId: memberships.networkId })
    .from(memberships).where(eq(memberships.userId, userId));
  if (memb.length === 0) return c.json({ networks: [] });
  const list = await db.select().from(networks)
    .where(inArray(networks.id, memb.map((m) => m.networkId)));
  return c.json({ networks: list });
});

// POST /api/networks — create network + owner membership
userNetworksRouter.post("/", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  let body: { name?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  const network = await createNetwork(body.name.trim());
  await addMembership(userId, network.id, "owner");
  return c.json({ network }, 201);
});

// GET /api/networks/:id — detail with packs + serverKeys
userNetworksRouter.get("/:id", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  const netRows = await db.select().from(networks).where(eq(networks.id, networkId));
  if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
  const packsList = await listPacksForNetwork(networkId);
  const skList = await db.select().from(serverKeys).where(eq(serverKeys.networkId, networkId));
  return c.json({ network: netRows[0], packs: packsList, serverKeys: skList });
});

// POST /api/networks/:id/server-keys — create server_key in network
userNetworksRouter.post("/:id/server-keys", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  let body: { label?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const label = typeof body.label === "string" ? body.label : null;

  const { id, key, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id, hash, label, networkId, createdAt: new Date(),
  });
  return c.json({ id, key, label }, 201);
});

// POST /api/networks/:id/packs — create pack in network
userNetworksRouter.post("/:id/packs", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  const body = await c.req.json<{ name?: string; description?: string }>();
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  const pack = await createPack({
    networkId,
    name: body.name.trim(),
    description: body.description ?? null,
  });
  return c.json({ pack }, 201);
});

// POST /api/networks/:id/packs/:packId/bindings/:serverKeyId — bind
userNetworksRouter.post("/:id/packs/:packId/bindings/:serverKeyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const skId = c.req.param("serverKeyId");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  // Verify pack and server_key both belong to this network
  const packRows = await db.select().from(packs).where(eq(packs.id, packId));
  if (packRows.length === 0 || packRows[0].networkId !== networkId) {
    return c.json({ error: "pack_not_in_network" }, 404);
  }
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, skId));
  if (skRows.length === 0 || skRows[0].networkId !== networkId) {
    return c.json({ error: "server_key_not_in_network" }, 404);
  }

  let body: { branch_name?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const branchName = typeof body.branch_name === "string" ? body.branch_name : "main";

  if (!(await getBranch(packId, branchName))) {
    return c.json({ error: "branch_not_found" }, 404);
  }

  await createBinding(skId, packId, branchName);
  return c.json({ ok: true }, 201);
});

// DELETE /api/networks/:id/server-keys/:keyId — owner only
userNetworksRouter.delete("/:id/server-keys/:keyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }
  // Explicit cascade: delete bindings first (FK also cascades, but be explicit)
  await db.delete(packBindings).where(eq(packBindings.serverKeyId, keyId));
  await db.delete(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  return c.body(null, 204);
});

// DELETE /api/networks/:id/packs/:packId/bindings/:serverKeyId — unbind
userNetworksRouter.delete("/:id/packs/:packId/bindings/:serverKeyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const skId = c.req.param("serverKeyId");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  await deleteBinding(skId, packId);
  return c.body(null, 204);
});
