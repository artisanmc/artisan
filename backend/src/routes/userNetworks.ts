// backend/src/routes/userNetworks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index";
import { networks, memberships, serverKeys, serverKeyHelloes } from "../db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { requireMember } from "../lib/membershipGuard";
import { listPacksForNetwork, createPack } from "../lib/packStorage";
import { generateServerKey } from "../lib/auth";
import { disconnectServerKey } from "../ws/hub";
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

// POST /api/networks/:id/packs — create pack in network (V1: pack belongs to one server_key)
userNetworksRouter.post("/:id/packs", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  const body = await c.req.json<{ name?: string; description?: string; serverKeyId?: string }>();
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  if (typeof body.serverKeyId !== "string" || body.serverKeyId.length === 0) {
    return c.json({ error: "missing_server_key" }, 422);
  }
  const skRows = await db.select().from(serverKeys).where(and(
    eq(serverKeys.id, body.serverKeyId),
    eq(serverKeys.networkId, networkId),
  ));
  if (skRows.length === 0) return c.json({ error: "server_key_not_in_network" }, 403);

  const pack = await createPack({
    networkId,
    serverKeyId: body.serverKeyId,
    name: body.name.trim(),
    description: body.description ?? null,
  });
  return c.json({ pack }, 201);
});

// GET /api/networks/:id/server-keys/:keyId/helloes?limit=30 — owner only.
// Audit timeline of plugin connections. The admin uses this to spot anomalies
// (unexpected IPs, hellos at odd hours) and decide whether to rotate the key.
userNetworksRouter.get("/:id/server-keys/:keyId/helloes", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }

  const sk = await db.select().from(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  if (sk.length === 0) return c.json({ error: "not_found" }, 404);

  const rawLimit = parseInt(c.req.query("limit") ?? "30", 10);
  const limit = Math.min(Math.max(isFinite(rawLimit) ? rawLimit : 30, 1), 200);

  const rows = await db
    .select()
    .from(serverKeyHelloes)
    .where(eq(serverKeyHelloes.serverKeyId, keyId))
    .orderBy(desc(serverKeyHelloes.helloAt))
    .limit(limit);

  return c.json({
    helloes: rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      mc_version: r.mcVersion,
      hello_at: r.helloAt.toISOString(),
      rejected_reason: r.rejectedReason,
    })),
  });
});

// GET /api/networks/:id/server-keys/:keyId/allowlist — owner only.
// Returns the optional source-IP allowlist. null/empty = no restriction.
userNetworksRouter.get("/:id/server-keys/:keyId/allowlist", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }

  const sk = await db.select().from(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  if (sk.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ allowed_ips: sk[0].allowedIps ?? null });
});

// PUT /api/networks/:id/server-keys/:keyId/allowlist — owner only.
// Body `{ allowed_ips: string[] | null }`. Pass null (or omit) to remove the
// restriction; pass an array to require source IP membership on hello.
userNetworksRouter.put("/:id/server-keys/:keyId/allowlist", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }

  let body: { allowed_ips?: unknown } = {};
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }

  let allowedIps: string[] | null;
  if (body.allowed_ips === null || body.allowed_ips === undefined) {
    allowedIps = null;
  } else if (Array.isArray(body.allowed_ips) && body.allowed_ips.every((v) => typeof v === "string" && v.trim().length > 0)) {
    // Dedup + trim. We don't validate IP syntax — admins may have IPv4, IPv6,
    // x-forwarded-for chains, or "unknown" (proxied env without IP header).
    allowedIps = Array.from(new Set((body.allowed_ips as string[]).map((s) => s.trim())));
    if (allowedIps.length === 0) allowedIps = null;
  } else {
    return c.json({ error: "invalid_allowed_ips" }, 422);
  }

  const updated = await db
    .update(serverKeys)
    .set({ allowedIps })
    .where(and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)))
    .returning({ id: serverKeys.id });
  if (updated.length === 0) return c.json({ error: "not_found" }, 404);

  return c.json({ allowed_ips: allowedIps });
});

// POST /api/networks/:id/server-keys/:keyId/rotate — owner only.
// Generates a new plaintext key for the same row (id/label/bindings preserved),
// invalidates the old hash, and forcefully drops the auth on any live plugin
// connection still using the old key.
userNetworksRouter.post("/:id/server-keys/:keyId/rotate", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }

  const existing = await db.select().from(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  if (existing.length === 0) return c.json({ error: "not_found" }, 404);

  const { key, hash } = await generateServerKey();
  await db.update(serverKeys).set({ hash }).where(eq(serverKeys.id, keyId));
  disconnectServerKey(keyId);

  return c.json({ id: keyId, key, label: existing[0].label });
});

// DELETE /api/networks/:id/server-keys/:keyId — owner only
userNetworksRouter.delete("/:id/server-keys/:keyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId, "owner"); } catch { return c.json({ error: "forbidden" }, 403); }
  // packs.serverKeyId has ON DELETE CASCADE — deleting the server_key cascades to its packs.
  await db.delete(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  return c.body(null, 204);
});

