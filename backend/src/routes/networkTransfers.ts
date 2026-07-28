// backend/src/routes/networkTransfers.ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { memberships, networks, projects, serverKeys, networkTransfers } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { findSession } from "../lib/sessionManager";
import { requireCapability } from "../lib/membershipGuard";
import { resolveNetworkRef } from "../lib/refs";
import { createTransfer, getTransfer } from "../lib/networkTransferStorage";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

export const networkTransfersRouter = new Hono();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAuthedUserId(c: any): Promise<string | null> {
  const sid = getCookie(c, "artisan_user_session");
  if (!sid) return null;
  const session = await findSession(sid);
  return session?.userId ?? null;
}

// POST /api/networks/:id/transfer/init — owner only
networkTransfersRouter.post("/:id/transfer/init", async (c) => {
  const userId = await getAuthedUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  // Le paramètre peut être un slug (les URLs de l'éditeur en portent).
  const networkId = await resolveNetworkRef(c.req.param("id"));
  if (!networkId) return c.json({ error: "forbidden" }, 403);
  try {
    await requireCapability(userId, networkId, "transfer_network");
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  const transfer = await createTransfer(networkId, userId);
  return c.json({
    url: `${EDITOR_URL}/transfer?token=${transfer.token}`,
    expiresAt: transfer.expiresAt.toISOString(),
  }, 201);
});

// GET /api/networks/transfer/:token — no auth required
networkTransfersRouter.get("/transfer/:token", async (c) => {
  const token = c.req.param("token");
  const transfer = await getTransfer(token);
  if (!transfer) return c.json({ error: "not_found" }, 404);
  if (transfer.consumedAt) return c.json({ error: "consumed" }, 410);
  if (transfer.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  const [network] = await db.select().from(networks).where(eq(networks.id, transfer.networkId));
  if (!network) return c.json({ error: "not_found" }, 404);
  const networkProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.networkId, transfer.networkId));
  const networkKeys = await db.select({ id: serverKeys.id }).from(serverKeys).where(eq(serverKeys.networkId, transfer.networkId));

  return c.json({
    networkId: transfer.networkId,
    networkName: network.name,
    projectCount: networkProjects.length,
    serverKeyCount: networkKeys.length,
    expiresAt: transfer.expiresAt.toISOString(),
  });
});

// POST /api/networks/transfer/:token/accept — auth required
networkTransfersRouter.post("/transfer/:token/accept", async (c) => {
  const userId = await getAuthedUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const token = c.req.param("token");
  const transfer = await getTransfer(token);
  if (!transfer) return c.json({ error: "not_found" }, 404);
  if (transfer.consumedAt) return c.json({ error: "consumed" }, 410);
  if (transfer.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  await db.transaction(async (tx) => {
    // Drop all existing memberships for this network (clean ownership transfer)
    await tx.delete(memberships).where(eq(memberships.networkId, transfer.networkId));
    const newMembId = "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await tx.insert(memberships).values({
      id: newMembId,
      userId,
      networkId: transfer.networkId,
      role: "owner",
      createdAt: new Date(),
    });
    await tx.update(networkTransfers)
      .set({ consumedAt: new Date(), consumedByUserId: userId })
      .where(eq(networkTransfers.token, token));
  });

  return c.json({ ok: true, networkId: transfer.networkId });
});
