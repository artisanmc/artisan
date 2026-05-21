// backend/src/routes/userNetworks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index";
import { networks, memberships, serverKeys } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { requireMember } from "../lib/membershipGuard";
import { listPacksForNetwork } from "../lib/packStorage";
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
