// backend/src/routes/userNetworks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index";
import { networks, memberships } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userNetworksRouter = new Hono<{ Variables: Vars }>();

// Helper: get authenticated userId or return 401
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
